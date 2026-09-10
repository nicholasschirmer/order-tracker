namespace OrderTracker.Api.Domain;

/// <summary>One point on an order's status timeline.</summary>
public class OrderStatusChange
{
    public int Id { get; set; }
    public Guid OrderId { get; set; }
    public OrderStatus Status { get; set; }
    public DateTimeOffset ChangedAt { get; set; }
}
