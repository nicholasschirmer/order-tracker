using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using OrderTracker.Api.Contracts;
using OrderTracker.Api.Data;
using OrderTracker.Api.Domain;

namespace OrderTracker.Api.Services;

public abstract record CreateOrderResult
{
    /// <summary>A brand-new order was stored.</summary>
    public sealed record Created(Order Order) : CreateOrderResult;

    /// <summary>The same order had already been stored; the original is returned unchanged.</summary>
    public sealed record Replayed(Order Order) : CreateOrderResult;

    /// <summary>The reference is already used by an order with different details.</summary>
    public sealed record Conflict(Order Existing) : CreateOrderResult;
}

public abstract record UpdateStatusResult
{
    public sealed record Updated(Order Order) : UpdateStatusResult;
    public sealed record NotFound : UpdateStatusResult;
    public sealed record IllegalTransition(OrderStatus From, OrderStatus To) : UpdateStatusResult;
}

public sealed class OrderService(OrderDbContext db, TimeProvider clock)
{
    private const int SqliteConstraintViolation = 19;

    /// <summary>
    /// Idempotent create. Callers must validate the request first.
    /// </summary>
    public async Task<CreateOrderResult> CreateAsync(CreateOrderRequest request, CancellationToken ct = default)
    {
        var lines = request.Lines!
            .Select(l => new OrderLine { Product = l.Product!, Quantity = l.Quantity, UnitPrice = l.UnitPrice })
            .ToList();
        var normalized = ReferenceNormalizer.Normalize(request.ClientReference!);

        var existing = await FindByNormalizedReference(normalized, ct);
        if (existing is not null)
        {
            return Compare(existing, request.CustomerName!, lines);
        }

        var order = Order.Create(request.ClientReference!, request.CustomerName!, lines, clock.GetUtcNow());
        db.Orders.Add(order);
        try
        {
            await db.SaveChangesAsync(ct);
            return new CreateOrderResult.Created(order);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Another request won the race between our lookup and insert. The unique index
            // protected us; fall back to the same compare-and-return logic.
            db.ChangeTracker.Clear();
            var winner = await FindByNormalizedReference(normalized, ct)
                         ?? throw new InvalidOperationException("Unique violation reported but no order found.");
            return Compare(winner, request.CustomerName!, lines);
        }
    }

    public Task<Order?> GetAsync(Guid id, CancellationToken ct = default) =>
        db.Orders.FirstOrDefaultAsync(o => o.Id == id, ct);

    public async Task<List<Order>> ListAsync(OrderStatus? status, string? search, CancellationToken ct = default)
    {
        IQueryable<Order> query = db.Orders;

        if (status is not null)
        {
            query = query.Where(o => o.Status == status);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToUpperInvariant();
            query = query.Where(o =>
                o.NormalizedReference.Contains(term) ||
                o.CustomerName.ToUpper().Contains(term));
        }

        return await query.OrderByDescending(o => o.CreatedAt).ThenByDescending(o => o.Id).ToListAsync(ct);
    }

    public async Task<UpdateStatusResult> UpdateStatusAsync(Guid id, OrderStatus next, CancellationToken ct = default)
    {
        var order = await GetAsync(id, ct);
        if (order is null) return new UpdateStatusResult.NotFound();

        try
        {
            order.TransitionTo(next, clock.GetUtcNow());
        }
        catch (InvalidStatusTransitionException ex)
        {
            return new UpdateStatusResult.IllegalTransition(ex.From, ex.To);
        }

        await db.SaveChangesAsync(ct);
        return new UpdateStatusResult.Updated(order);
    }

    private Task<Order?> FindByNormalizedReference(string normalized, CancellationToken ct) =>
        db.Orders.FirstOrDefaultAsync(o => o.NormalizedReference == normalized, ct);

    private static CreateOrderResult Compare(Order existing, string customerName, List<OrderLine> lines) =>
        existing.HasSamePayload(customerName, lines)
            ? new CreateOrderResult.Replayed(existing)
            : new CreateOrderResult.Conflict(existing);

    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is SqliteException { SqliteErrorCode: SqliteConstraintViolation };
}
