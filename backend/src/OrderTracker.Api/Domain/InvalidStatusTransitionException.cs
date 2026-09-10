namespace OrderTracker.Api.Domain;

public sealed class InvalidStatusTransitionException(OrderStatus from, OrderStatus to)
    : InvalidOperationException($"Cannot change an order from {from} to {to}.")
{
    public OrderStatus From { get; } = from;
    public OrderStatus To { get; } = to;
}
