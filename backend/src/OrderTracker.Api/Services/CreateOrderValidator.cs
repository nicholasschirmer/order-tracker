using OrderTracker.Api.Contracts;

namespace OrderTracker.Api.Services;

/// <summary>Request validation producing RFC 7807 style field → messages maps.</summary>
public static class CreateOrderValidator
{
    public const int MaxReferenceLength = 64;
    public const int MaxNameLength = 200;

    public static Dictionary<string, string[]> Validate(CreateOrderRequest? request)
    {
        var errors = new Dictionary<string, List<string>>();

        if (request is null)
        {
            Add(errors, "body", "A JSON body is required.");
            return Finish(errors);
        }

        if (string.IsNullOrWhiteSpace(request.ClientReference))
            Add(errors, "clientReference", "Client reference is required.");
        else if (request.ClientReference.Trim().Length > MaxReferenceLength)
            Add(errors, "clientReference", $"Client reference must be at most {MaxReferenceLength} characters.");

        if (string.IsNullOrWhiteSpace(request.CustomerName))
            Add(errors, "customerName", "Customer name is required.");
        else if (request.CustomerName.Trim().Length > MaxNameLength)
            Add(errors, "customerName", $"Customer name must be at most {MaxNameLength} characters.");

        if (request.Lines is null || request.Lines.Count == 0)
        {
            Add(errors, "lines", "At least one line item is required.");
        }
        else
        {
            for (var i = 0; i < request.Lines.Count; i++)
            {
                var line = request.Lines[i];
                if (line is null)
                {
                    Add(errors, $"lines[{i}]", "Line item is required.");
                    continue;
                }
                if (string.IsNullOrWhiteSpace(line.Product))
                    Add(errors, $"lines[{i}].product", "Product is required.");
                else if (line.Product.Trim().Length > MaxNameLength)
                    Add(errors, $"lines[{i}].product", $"Product must be at most {MaxNameLength} characters.");
                if (line.Quantity <= 0)
                    Add(errors, $"lines[{i}].quantity", "Quantity must be greater than zero.");
                if (line.UnitPrice < 0)
                    Add(errors, $"lines[{i}].unitPrice", "Unit price cannot be negative.");
            }
        }

        return Finish(errors);
    }

    private static void Add(Dictionary<string, List<string>> errors, string key, string message)
    {
        if (!errors.TryGetValue(key, out var list)) errors[key] = list = [];
        list.Add(message);
    }

    private static Dictionary<string, string[]> Finish(Dictionary<string, List<string>> errors) =>
        errors.ToDictionary(kv => kv.Key, kv => kv.Value.ToArray());
}
