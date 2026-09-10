using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using OrderTracker.Api.Contracts;
using OrderTracker.Api.Data;
using OrderTracker.Api.Domain;
using OrderTracker.Api.Services;

namespace OrderTracker.Api.Tests.Services;

/// <summary>
/// Duplicate-prevention rules exercised directly against <see cref="OrderService"/> and the
/// database, without HTTP. Covers every layer: normalised key, compare-and-return, the unique
/// index, and the fallback path taken when a concurrent insert wins the race.
/// </summary>
public sealed class OrderServiceDuplicateTests : IDisposable
{
    private static readonly DateTimeOffset T0 = new(2026, 9, 10, 9, 0, 0, TimeSpan.Zero);
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"dup-{Guid.NewGuid():N}.db");

    public OrderServiceDuplicateTests()
    {
        using var db = NewContext();
        db.Database.EnsureCreated();
        db.Database.ExecuteSqlRaw("PRAGMA journal_mode=WAL;");
    }

    public void Dispose()
    {
        foreach (var suffix in new[] { "", "-wal", "-shm" }) { try { File.Delete(_path + suffix); } catch { } }
    }

    // ---------- helpers ----------

    private OrderDbContext NewContext(IInterceptor? interceptor = null)
    {
        var builder = new DbContextOptionsBuilder<OrderDbContext>().UseSqlite($"Data Source={_path}");
        if (interceptor is not null) builder.AddInterceptors(interceptor);
        return new OrderDbContext(builder.Options);
    }

    private OrderService NewService(OrderDbContext db) => new(db, new FixedClock(T0));

    private static CreateOrderRequest Acme(string reference = "PO-100") =>
        new(reference, "Acme Ltd", [new OrderLineRequest("Widget", 10, 2.50m)]);

    private int RowCount()
    {
        using var db = NewContext();
        return db.Orders.Count();
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    /// <summary>
    /// Fires once, just before the first order INSERT, and lets a competitor write to the same
    /// database first. This reproduces the lookup→insert race deterministically.
    /// </summary>
    private sealed class RaceInterceptor(Action competitor) : SaveChangesInterceptor
    {
        private bool _fired;

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (!_fired && eventData.Context!.ChangeTracker.Entries<Order>().Any(e => e.State == EntityState.Added))
            {
                _fired = true;
                competitor();
            }
            return ValueTask.FromResult(result);
        }
    }

    // ---------- compare-and-return ----------

    [Fact]
    public async Task First_submission_is_Created()
    {
        using var db = NewContext();

        var result = await NewService(db).CreateAsync(Acme());

        var created = Assert.IsType<CreateOrderResult.Created>(result);
        Assert.Equal("PO-100", created.Order.ClientReference);
        Assert.Equal(1, RowCount());
    }

    [Fact]
    public async Task Identical_resubmission_is_Replayed_with_the_original_and_writes_nothing()
    {
        using var db = NewContext();
        var service = NewService(db);
        var first = Assert.IsType<CreateOrderResult.Created>(await service.CreateAsync(Acme()));

        var second = await service.CreateAsync(Acme());

        var replayed = Assert.IsType<CreateOrderResult.Replayed>(second);
        Assert.Equal(first.Order.Id, replayed.Order.Id);
        Assert.Equal(first.Order.CreatedAt, replayed.Order.CreatedAt);
        Assert.Equal(1, RowCount());
    }

    [Fact]
    public async Task Resubmission_from_a_different_request_scope_is_still_Replayed()
    {
        // Each HTTP request gets its own DbContext; the replay must not rely on the change tracker.
        Guid firstId;
        using (var db1 = NewContext())
        {
            firstId = Assert.IsType<CreateOrderResult.Created>(await NewService(db1).CreateAsync(Acme())).Order.Id;
        }

        using var db2 = NewContext();
        var result = await NewService(db2).CreateAsync(Acme());

        Assert.Equal(firstId, Assert.IsType<CreateOrderResult.Replayed>(result).Order.Id);
        Assert.Equal(1, RowCount());
    }

    [Theory]
    [InlineData("Globex Inc", "Widget", 10, 2.50)]   // different customer
    [InlineData("Acme Ltd", "Gadget", 10, 2.50)]     // different product
    [InlineData("Acme Ltd", "Widget", 11, 2.50)]     // different quantity
    [InlineData("Acme Ltd", "Widget", 10, 2.51)]     // different price
    public async Task Same_reference_with_different_details_is_Conflict_and_leaves_original_untouched(
        string customer, string product, int quantity, double price)
    {
        using var db = NewContext();
        var service = NewService(db);
        var original = Assert.IsType<CreateOrderResult.Created>(await service.CreateAsync(Acme())).Order;

        var result = await service.CreateAsync(new CreateOrderRequest("PO-100", customer,
            [new OrderLineRequest(product, quantity, (decimal)price)]));

        var conflict = Assert.IsType<CreateOrderResult.Conflict>(result);
        Assert.Equal(original.Id, conflict.Existing.Id);
        Assert.Equal("Acme Ltd", conflict.Existing.CustomerName);
        Assert.Equal(25.00m, conflict.Existing.Total);
        Assert.Equal(1, RowCount());
    }

    [Fact]
    public async Task Extra_line_makes_it_a_Conflict_even_when_the_first_line_matches()
    {
        using var db = NewContext();
        var service = NewService(db);
        await service.CreateAsync(Acme());

        var result = await service.CreateAsync(new CreateOrderRequest("PO-100", "Acme Ltd",
            [new OrderLineRequest("Widget", 10, 2.50m), new OrderLineRequest("Gizmo", 1, 1m)]));

        Assert.IsType<CreateOrderResult.Conflict>(result);
        Assert.Equal(1, RowCount());
    }

    [Theory]
    [InlineData("po-100")]
    [InlineData("  PO-100  ")]
    [InlineData("\tPo-100\n")]
    public async Task Reference_matching_ignores_case_and_surrounding_whitespace(string variant)
    {
        using var db = NewContext();
        var service = NewService(db);
        var first = Assert.IsType<CreateOrderResult.Created>(await service.CreateAsync(Acme("PO-100"))).Order;

        var result = await service.CreateAsync(Acme(variant));

        Assert.Equal(first.Id, Assert.IsType<CreateOrderResult.Replayed>(result).Order.Id);
        Assert.Equal(1, RowCount());
    }

    [Fact]
    public async Task Payload_comparison_ignores_case_and_whitespace_in_text_fields()
    {
        using var db = NewContext();
        var service = NewService(db);
        await service.CreateAsync(Acme());

        var result = await service.CreateAsync(new CreateOrderRequest("PO-100", "  acme ltd ",
            [new OrderLineRequest(" WIDGET ", 10, 2.50m)]));

        Assert.IsType<CreateOrderResult.Replayed>(result);
    }

    [Fact]
    public async Task Different_references_are_independent_orders()
    {
        using var db = NewContext();
        var service = NewService(db);

        Assert.IsType<CreateOrderResult.Created>(await service.CreateAsync(Acme("PO-100")));
        Assert.IsType<CreateOrderResult.Created>(await service.CreateAsync(Acme("PO-101")));

        Assert.Equal(2, RowCount());
    }

    // ---------- the hard guarantee: unique index ----------

    [Fact]
    public void Database_rejects_a_second_row_with_the_same_normalised_reference()
    {
        using var db = NewContext();
        db.Orders.Add(Order.Create("PO-100", "Acme Ltd", [new OrderLine { Product = "W", Quantity = 1, UnitPrice = 1m }], T0));
        db.SaveChanges();

        db.Orders.Add(Order.Create("po-100", "Globex Inc", [new OrderLine { Product = "G", Quantity = 1, UnitPrice = 1m }], T0));

        var ex = Assert.Throws<DbUpdateException>(() => db.SaveChanges());
        Assert.Contains("UNIQUE", ex.InnerException?.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(1, RowCount());
    }

    // ---------- losing the race between lookup and insert ----------

    [Fact]
    public async Task Losing_the_insert_race_with_an_identical_order_falls_back_to_Replayed()
    {
        Guid winnerId = Guid.Empty;
        var interceptor = new RaceInterceptor(() =>
        {
            // A "concurrent request" commits the same order after our lookup found nothing.
            using var other = NewContext();
            winnerId = Assert.IsType<CreateOrderResult.Created>(NewService(other).CreateAsync(Acme()).GetAwaiter().GetResult()).Order.Id;
        });
        using var db = NewContext(interceptor);

        var result = await NewService(db).CreateAsync(Acme());

        var replayed = Assert.IsType<CreateOrderResult.Replayed>(result);
        Assert.Equal(winnerId, replayed.Order.Id);
        Assert.Equal(1, RowCount());
        // The failed insert was discarded: nothing is pending and only the winner is tracked.
        Assert.DoesNotContain(db.ChangeTracker.Entries(), e => e.State == EntityState.Added);
        Assert.All(db.ChangeTracker.Entries<Order>(), e => Assert.Equal(winnerId, e.Entity.Id));
    }

    [Fact]
    public async Task Losing_the_insert_race_with_a_different_order_falls_back_to_Conflict()
    {
        var interceptor = new RaceInterceptor(() =>
        {
            using var other = NewContext();
            NewService(other).CreateAsync(new CreateOrderRequest("PO-100", "Globex Inc",
                [new OrderLineRequest("Gadget", 1, 99.99m)])).GetAwaiter().GetResult();
        });
        using var db = NewContext(interceptor);

        var result = await NewService(db).CreateAsync(Acme());

        var conflict = Assert.IsType<CreateOrderResult.Conflict>(result);
        Assert.Equal("Globex Inc", conflict.Existing.CustomerName);
        Assert.Equal(1, RowCount());
    }

    [Fact]
    public async Task Many_parallel_submissions_through_separate_contexts_create_exactly_one_order()
    {
        var results = await Task.WhenAll(Enumerable.Range(0, 12).Select(async _ =>
        {
            using var db = NewContext();
            return await NewService(db).CreateAsync(Acme("PO-RACE"));
        }));

        Assert.Equal(1, results.Count(r => r is CreateOrderResult.Created));
        Assert.Equal(11, results.Count(r => r is CreateOrderResult.Replayed));
        Assert.DoesNotContain(results, r => r is CreateOrderResult.Conflict);
        var ids = results.Select(r => r switch
        {
            CreateOrderResult.Created c => c.Order.Id,
            CreateOrderResult.Replayed p => p.Order.Id,
            _ => Guid.Empty,
        }).Distinct();
        Assert.Single(ids);
        Assert.Equal(1, RowCount());
    }
}
