namespace OrderTracker.Api.Contracts;

public record CreateOrderRequest(string? ClientReference, string? CustomerName, List<OrderLineRequest>? Lines);

public record OrderLineRequest(string? Product, int Quantity, decimal UnitPrice);

public record UpdateStatusRequest(string? Status);
