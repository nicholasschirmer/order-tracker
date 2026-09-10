namespace OrderTracker.Api.Domain;

public enum OrderStatus
{
    Submitted,
    Approved,
    Shipped,
    Delivered,
    Cancelled,
    /// <summary>Shipped but never arrived. Terminal, like Delivered and Cancelled.</summary>
    LostInTransit
}
