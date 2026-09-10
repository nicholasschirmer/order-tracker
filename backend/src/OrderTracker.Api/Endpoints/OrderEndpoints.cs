using Microsoft.AspNetCore.Http.HttpResults;
using OrderTracker.Api.Contracts;
using OrderTracker.Api.Domain;
using OrderTracker.Api.Services;

namespace OrderTracker.Api.Endpoints;

public static class OrderEndpoints
{
    public const string ReplayHeader = "X-Idempotent-Replay";

    public static IEndpointRouteBuilder MapOrderEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/orders");

        group.MapPost("", CreateAsync);
        group.MapGet("", ListAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPatch("/{id:guid}/status", UpdateStatusAsync);

        return app;
    }

    private static async Task<IResult> CreateAsync(CreateOrderRequest? request, OrderService service, HttpContext http, CancellationToken ct)
    {
        var errors = CreateOrderValidator.Validate(request);
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors, title: "The order is invalid.");
        }

        var result = await service.CreateAsync(request!, ct);
        switch (result)
        {
            case CreateOrderResult.Created created:
                return Results.Created($"/api/orders/{created.Order.Id}", OrderResponse.From(created.Order));

            case CreateOrderResult.Replayed replayed:
                http.Response.Headers[ReplayHeader] = "true";
                return Results.Ok(OrderResponse.From(replayed.Order));

            case CreateOrderResult.Conflict conflict:
                return Results.Problem(
                    statusCode: StatusCodes.Status409Conflict,
                    title: "Client reference already used",
                    detail: $"Client reference '{conflict.Existing.ClientReference}' was already submitted with different details. " +
                            "Use a new reference, or check the existing order.",
                    extensions: new Dictionary<string, object?>
                    {
                        ["clientReference"] = conflict.Existing.ClientReference,
                        ["existingOrderId"] = conflict.Existing.Id,
                    });

            default:
                throw new InvalidOperationException($"Unhandled result {result.GetType().Name}");
        }
    }

    private static async Task<IResult> ListAsync(string? status, string? search, OrderService service, CancellationToken ct)
    {
        OrderStatus? filter = null;
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!TryParseStatus(status, out var parsed))
            {
                return Results.ValidationProblem(
                    new Dictionary<string, string[]> { ["status"] = [$"'{status}' is not a known status."] },
                    title: "Invalid query.");
            }
            filter = parsed;
        }

        var orders = await service.ListAsync(filter, search, ct);
        return Results.Ok(orders.Select(OrderResponse.From).ToList());
    }

    private static async Task<IResult> GetAsync(Guid id, OrderService service, CancellationToken ct)
    {
        var order = await service.GetAsync(id, ct);
        return order is null ? NotFound(id) : Results.Ok(OrderResponse.From(order));
    }

    private static async Task<IResult> UpdateStatusAsync(Guid id, UpdateStatusRequest? request, OrderService service, CancellationToken ct)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.Status) || !TryParseStatus(request.Status, out var next))
        {
            return Results.ValidationProblem(
                new Dictionary<string, string[]> { ["status"] = [$"'{request?.Status}' is not a known status."] },
                title: "Invalid status.");
        }

        var result = await service.UpdateStatusAsync(id, next, ct);
        return result switch
        {
            UpdateStatusResult.Updated updated => Results.Ok(OrderResponse.From(updated.Order)),
            UpdateStatusResult.NotFound => NotFound(id),
            UpdateStatusResult.IllegalTransition illegal => Results.Problem(
                statusCode: StatusCodes.Status422UnprocessableEntity,
                title: "Illegal status transition",
                detail: $"An order in status {illegal.From} cannot be changed to {illegal.To}.",
                extensions: new Dictionary<string, object?>
                {
                    ["currentStatus"] = illegal.From.ToString(),
                    ["requestedStatus"] = illegal.To.ToString(),
                }),
            _ => throw new InvalidOperationException($"Unhandled result {result.GetType().Name}"),
        };
    }

    private static IResult NotFound(Guid id) => Results.Problem(
        statusCode: StatusCodes.Status404NotFound,
        title: "Order not found",
        detail: $"No order with id '{id}' exists.");

    /// <summary>Parses a status by name only (case-insensitive); numeric strings are rejected.</summary>
    private static bool TryParseStatus(string value, out OrderStatus status)
    {
        status = default;
        var trimmed = value.Trim();
        if (trimmed.Length == 0 || char.IsDigit(trimmed[0]) || trimmed[0] == '-') return false;
        return Enum.TryParse(trimmed, ignoreCase: true, out status) && Enum.IsDefined(status);
    }
}
