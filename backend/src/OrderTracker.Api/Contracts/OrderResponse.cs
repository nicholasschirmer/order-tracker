using OrderTracker.Api.Domain;

namespace OrderTracker.Api.Contracts;

public record OrderLineResponse(string Product, int Quantity, decimal UnitPrice, decimal LineTotal);

public record StatusChangeResponse(string Status, DateTimeOffset ChangedAt);

public record OrderResponse(
    Guid Id,
    string ClientReference,
    string CustomerName,
    string Status,
    decimal Total,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<OrderLineResponse> Lines,
    IReadOnlyList<string> AllowedTransitions,
    IReadOnlyList<StatusChangeResponse> StatusHistory)
{
    public static OrderResponse From(Order order) => new(
        order.Id,
        order.ClientReference,
        order.CustomerName,
        order.Status.ToString(),
        order.Total,
        order.CreatedAt,
        order.UpdatedAt,
        order.Lines.Select(l => new OrderLineResponse(l.Product, l.Quantity, l.UnitPrice, l.LineTotal)).ToList(),
        order.AllowedTransitions().Select(s => s.ToString()).ToList(),
        order.StatusHistory.OrderBy(h => h.ChangedAt).ThenBy(h => h.Id)
            .Select(h => new StatusChangeResponse(h.Status.ToString(), h.ChangedAt)).ToList());
}
