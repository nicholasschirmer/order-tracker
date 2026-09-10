using Microsoft.EntityFrameworkCore;
using OrderTracker.Api.Data;
using OrderTracker.Api.Domain;

namespace OrderTracker.Api.Tests.Data;

public sealed class DataSeederTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 9, 10, 12, 0, 0, TimeSpan.Zero);
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"seeder-{Guid.NewGuid():N}.db");

    private OrderDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<OrderDbContext>().UseSqlite($"Data Source={_path}").Options;
        var db = new OrderDbContext(options);
        db.Database.EnsureCreated();
        return db;
    }

    public void Dispose()
    {
        foreach (var suffix in new[] { "", "-wal", "-shm" }) { try { File.Delete(_path + suffix); } catch { } }
    }

    [Fact]
    public void Seeds_the_requested_number_of_valid_orders()
    {
        using var db = NewContext();

        var created = DataSeeder.Seed(db, 250, randomSeed: 7, now: Now);

        Assert.Equal(250, created);
        var orders = db.Orders.ToList();
        Assert.Equal(250, orders.Count);
        Assert.Equal(250, orders.Select(o => o.NormalizedReference).Distinct().Count());
        Assert.All(orders, o =>
        {
            Assert.False(string.IsNullOrWhiteSpace(o.CustomerName));
            Assert.InRange(o.Lines.Count, 1, 5);
            Assert.All(o.Lines, l => { Assert.True(l.Quantity > 0); Assert.True(l.UnitPrice >= 0); Assert.False(string.IsNullOrWhiteSpace(l.Product)); });
            Assert.True(o.CreatedAt <= Now);
            Assert.True(o.CreatedAt >= Now.AddDays(-90));
            Assert.True(o.UpdatedAt >= o.CreatedAt);
            Assert.True(o.UpdatedAt <= Now);
            Assert.True(Enum.IsDefined(o.Status));
        });
    }

    [Fact]
    public void Produces_a_spread_of_statuses_customers_and_dates()
    {
        using var db = NewContext();
        DataSeeder.Seed(db, 300, randomSeed: 1, now: Now);
        var orders = db.Orders.ToList();

        Assert.All(Enum.GetValues<OrderStatus>(), s => Assert.Contains(orders, o => o.Status == s));
        Assert.True(orders.Select(o => o.CustomerName).Distinct().Count() >= 15, "expected many distinct customers");
        Assert.True(orders.Select(o => o.CreatedAt.Date).Distinct().Count() >= 30, "expected orders across many days");
        Assert.Contains(orders, o => o.Lines.Count == 1);
        Assert.Contains(orders, o => o.Lines.Count >= 3);
        Assert.All(orders.Where(o => o.Status != OrderStatus.Submitted), o => Assert.True(o.UpdatedAt > o.CreatedAt));
        Assert.All(orders.Where(o => o.Status == OrderStatus.Submitted), o => Assert.Equal(o.CreatedAt, o.UpdatedAt));
    }

    [Fact]
    public void Seeded_orders_carry_a_consistent_status_history()
    {
        using var db = NewContext();
        DataSeeder.Seed(db, 150, randomSeed: 5, now: Now);

        Assert.All(db.Orders.ToList(), o =>
        {
            Assert.Equal(OrderStatus.Submitted, o.StatusHistory.First().Status);
            Assert.Equal(o.CreatedAt, o.StatusHistory.First().ChangedAt);
            Assert.Equal(o.Status, o.StatusHistory.Last().Status);
            Assert.Equal(o.UpdatedAt, o.StatusHistory.Last().ChangedAt);
            var times = o.StatusHistory.Select(h => h.ChangedAt).ToList();
            Assert.Equal(times.OrderBy(t => t), times);
            Assert.Equal(times.Count, times.Distinct().Count());
        });
    }

    [Fact]
    public void Is_deterministic_for_the_same_random_seed()
    {
        using var a = NewContext();
        DataSeeder.Seed(a, 20, randomSeed: 99, now: Now);
        var first = a.Orders.OrderBy(o => o.NormalizedReference).Select(o => o.NormalizedReference + "|" + o.CustomerName + "|" + o.Status).ToList();
        a.Orders.RemoveRange(a.Orders);
        a.SaveChanges();

        DataSeeder.Seed(a, 20, randomSeed: 99, now: Now);
        var second = a.Orders.OrderBy(o => o.NormalizedReference).Select(o => o.NormalizedReference + "|" + o.CustomerName + "|" + o.Status).ToList();

        Assert.Equal(first, second);
    }

    [Fact]
    public void Seeding_again_skips_references_that_already_exist()
    {
        using var db = NewContext();
        DataSeeder.Seed(db, 50, randomSeed: 3, now: Now);

        var added = DataSeeder.Seed(db, 50, randomSeed: 3, now: Now);

        Assert.Equal(0, added);
        Assert.Equal(50, db.Orders.Count());
    }
}
