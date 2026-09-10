namespace OrderTracker.Api.Domain;

public class Order
{
    private static readonly IReadOnlyDictionary<OrderStatus, OrderStatus[]> Transitions =
        new Dictionary<OrderStatus, OrderStatus[]>
        {
            [OrderStatus.Submitted] = [OrderStatus.Approved, OrderStatus.Cancelled],
            [OrderStatus.Approved] = [OrderStatus.Shipped, OrderStatus.Cancelled],
            [OrderStatus.Shipped] = [OrderStatus.Delivered],
            [OrderStatus.Delivered] = [],
            [OrderStatus.Cancelled] = [],
        };

    public Guid Id { get; private set; }

    /// <summary>The reference exactly as the rep typed it (trimmed).</summary>
    public string ClientReference { get; private set; } = string.Empty;

    /// <summary>Upper-cased key used for the unique index / idempotency lookup.</summary>
    public string NormalizedReference { get; private set; } = string.Empty;

    public string CustomerName { get; private set; } = string.Empty;
    public OrderStatus Status { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }
    public List<OrderLine> Lines { get; private set; } = [];

    /// <summary>Every status the order has been in, oldest first. Always starts with Submitted.</summary>
    public List<OrderStatusChange> StatusHistory { get; private set; } = [];

    public decimal Total => Lines.Sum(l => l.LineTotal);

    private Order() { } // EF Core

    public static Order Create(string clientReference, string customerName, IEnumerable<OrderLine> lines, DateTimeOffset now)
    {
        var order = new Order
        {
            Id = Guid.NewGuid(),
            ClientReference = clientReference.Trim(),
            NormalizedReference = ReferenceNormalizer.Normalize(clientReference),
            CustomerName = customerName.Trim(),
            Status = OrderStatus.Submitted,
            CreatedAt = now,
            UpdatedAt = now,
        };
        order.Lines.AddRange(lines.Select(l => new OrderLine
        {
            Product = l.Product.Trim(),
            Quantity = l.Quantity,
            UnitPrice = l.UnitPrice,
        }));
        order.StatusHistory.Add(new OrderStatusChange { Status = OrderStatus.Submitted, ChangedAt = now });
        return order;
    }

    public IReadOnlyList<OrderStatus> AllowedTransitions() => Transitions[Status];

    public bool CanTransitionTo(OrderStatus next) => Transitions[Status].Contains(next);

    public void TransitionTo(OrderStatus next, DateTimeOffset now)
    {
        if (!CanTransitionTo(next))
        {
            throw new InvalidStatusTransitionException(Status, next);
        }
        Status = next;
        UpdatedAt = now;
        StatusHistory.Add(new OrderStatusChange { Status = next, ChangedAt = now });
    }

    /// <summary>
    /// True when an incoming submission describes the same order: same customer and the same
    /// lines in the same sequence. Text is compared trimmed and case-insensitively.
    /// </summary>
    public bool HasSamePayload(string customerName, IReadOnlyList<OrderLine> lines)
    {
        if (!SameText(CustomerName, customerName)) return false;
        if (Lines.Count != lines.Count) return false;
        for (var i = 0; i < Lines.Count; i++)
        {
            var mine = Lines[i];
            var theirs = lines[i];
            if (!SameText(mine.Product, theirs.Product)) return false;
            if (mine.Quantity != theirs.Quantity) return false;
            if (mine.UnitPrice != theirs.UnitPrice) return false;
        }
        return true;
    }

    private static bool SameText(string a, string b) =>
        string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
}
