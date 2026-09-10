using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using OrderTracker.Api.Contracts;

namespace OrderTracker.Api.Tests.Api;

/// <summary>
/// HTTP-level scenario tests. Each test boots a fresh API + SQLite database.
/// Names carry the scenario id from docs/scenarios.md.
/// </summary>
public sealed class OrdersApiTests : IDisposable
{
    private readonly OrderTrackerFactory _factory = new();
    private readonly HttpClient _client;

    public OrdersApiTests()
    {
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    // ---------- helpers ----------

    private static CreateOrderRequest Acme(string reference = "PO-100") => new(
        reference,
        "Acme Ltd",
        [new OrderLineRequest("Widget", 10, 2.50m)]);

    private static CreateOrderRequest Globex(string reference = "PO-200") => new(
        reference,
        "Globex Inc",
        [new OrderLineRequest("Gadget", 1, 99.99m), new OrderLineRequest("Gizmo", 2, 0.01m)]);

    private Task<HttpResponseMessage> PostOrder(object body) => _client.PostAsJsonAsync("/api/orders", body);

    private async Task<OrderResponse> CreateOrder(CreateOrderRequest request)
    {
        var response = await PostOrder(request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<OrderResponse>())!;
    }

    private Task<HttpResponseMessage> PatchStatus(Guid id, string status) =>
        _client.PatchAsJsonAsync($"/api/orders/{id}/status", new UpdateStatusRequest(status));

    private static async Task<ProblemDetails> Problem(HttpResponseMessage response)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        return (await response.Content.ReadFromJsonAsync<ProblemDetails>())!;
    }

    private static async Task<ValidationProblemDetails> ValidationProblem(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        return (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>())!;
    }

    // ---------- Order submission ----------

    [Fact]
    public async Task S01_Submit_valid_new_order_returns_201_with_location_and_computed_fields()
    {
        var response = await PostOrder(Acme());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var order = await response.Content.ReadFromJsonAsync<OrderResponse>();
        Assert.NotNull(order);
        Assert.NotEqual(Guid.Empty, order.Id);
        Assert.Equal("PO-100", order.ClientReference);
        Assert.Equal("Acme Ltd", order.CustomerName);
        Assert.Equal("Submitted", order.Status);
        Assert.Equal(25.00m, order.Total);
        Assert.Single(order.Lines);
        Assert.Equal(["Approved", "Cancelled"], order.AllowedTransitions);
        Assert.Equal($"/api/orders/{order.Id}", response.Headers.Location?.ToString());
        Assert.False(response.Headers.Contains("X-Idempotent-Replay"));
    }

    [Fact]
    public async Task S02_Resubmitting_identical_order_returns_200_replay_of_original()
    {
        var first = await CreateOrder(Acme());

        var response = await PostOrder(Acme());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("true", response.Headers.GetValues("X-Idempotent-Replay").Single());
        var replay = await response.Content.ReadFromJsonAsync<OrderResponse>();
        Assert.Equal(first.Id, replay!.Id);
        Assert.Equal(first.CreatedAt, replay.CreatedAt);

        var all = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders");
        Assert.Single(all!);
    }

    [Fact]
    public async Task S03_Resubmitting_same_reference_with_different_details_returns_409_and_changes_nothing()
    {
        var original = await CreateOrder(Acme());

        var response = await PostOrder(Globex("PO-100"));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var problem = await Problem(response);
        Assert.Contains("PO-100", problem.Detail);
        Assert.Equal(original.Id.ToString(), problem.Extensions["existingOrderId"]?.ToString());

        var all = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders");
        var stored = Assert.Single(all!);
        Assert.Equal("Acme Ltd", stored.CustomerName);
        Assert.Equal(25.00m, stored.Total);
    }

    [Fact]
    public async Task S04_Reference_matching_is_case_insensitive_and_trimmed()
    {
        var first = await CreateOrder(Acme("PO-100"));

        var response = await PostOrder(Acme("  po-100 "));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var replay = await response.Content.ReadFromJsonAsync<OrderResponse>();
        Assert.Equal(first.Id, replay!.Id);
        Assert.Equal("PO-100", replay.ClientReference);
    }

    [Fact]
    public async Task S05_Concurrent_submissions_of_same_reference_create_exactly_one_order()
    {
        var responses = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => PostOrder(Acme("PO-RACE"))));

        var statuses = responses.Select(r => r.StatusCode).ToList();
        Assert.Equal(1, statuses.Count(s => s == HttpStatusCode.Created));
        Assert.Equal(9, statuses.Count(s => s == HttpStatusCode.OK));

        var ids = new HashSet<Guid>();
        foreach (var r in responses)
        {
            ids.Add((await r.Content.ReadFromJsonAsync<OrderResponse>())!.Id);
        }
        Assert.Single(ids);

        var all = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders");
        Assert.Single(all!);
    }

    [Fact]
    public async Task S06_Missing_required_fields_return_400_listing_each_field_and_store_nothing()
    {
        var response = await PostOrder(new { clientReference = "", customerName = "  ", lines = Array.Empty<object>() });

        var problem = await ValidationProblem(response);
        Assert.Contains("clientReference", problem.Errors.Keys);
        Assert.Contains("customerName", problem.Errors.Keys);
        Assert.Contains("lines", problem.Errors.Keys);

        var all = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders");
        Assert.Empty(all!);
    }

    [Fact]
    public async Task S06_Missing_lines_property_entirely_returns_400()
    {
        var response = await PostOrder(new { clientReference = "PO-1", customerName = "Acme" });

        var problem = await ValidationProblem(response);
        Assert.Contains("lines", problem.Errors.Keys);
    }

    [Fact]
    public async Task S07_Invalid_line_items_return_400_naming_the_line_index()
    {
        var response = await PostOrder(new CreateOrderRequest("PO-1", "Acme", [
            new OrderLineRequest("Widget", 1, 1m),
            new OrderLineRequest("", 0, -1m)
        ]));

        var problem = await ValidationProblem(response);
        Assert.Contains("lines[1].product", problem.Errors.Keys);
        Assert.Contains("lines[1].quantity", problem.Errors.Keys);
        Assert.Contains("lines[1].unitPrice", problem.Errors.Keys);
        Assert.DoesNotContain(problem.Errors.Keys, k => k.StartsWith("lines[0]"));
    }

    [Fact]
    public async Task S08_Reference_longer_than_64_chars_returns_400()
    {
        var response = await PostOrder(Acme(new string('X', 65)));

        var problem = await ValidationProblem(response);
        Assert.Contains("clientReference", problem.Errors.Keys);
    }

    [Fact]
    public async Task S08_Reference_of_exactly_64_chars_is_accepted()
    {
        var response = await PostOrder(Acme(new string('X', 64)));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // ---------- Viewing orders ----------

    [Fact]
    public async Task S09_List_returns_orders_newest_first_with_totals_and_status()
    {
        var a = await CreateOrder(Acme("PO-1"));
        var b = await CreateOrder(Acme("PO-2"));
        var c = await CreateOrder(Globex("PO-3"));

        var all = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders");

        Assert.NotNull(all);
        Assert.Equal([c.Id, b.Id, a.Id], all.Select(o => o.Id));
        Assert.All(all, o => Assert.Equal("Submitted", o.Status));
        Assert.Equal(100.01m, all[0].Total);
        Assert.Equal(25.00m, all[1].Total);
    }

    [Fact]
    public async Task S10_Empty_list_returns_200_with_empty_array()
    {
        var response = await _client.GetAsync("/api/orders");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("[]", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task S11_Filter_by_status_returns_only_matching_orders()
    {
        var a = await CreateOrder(Acme("PO-1"));
        var b = await CreateOrder(Acme("PO-2"));
        await PatchStatus(b.Id, "Approved");

        var approved = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders?status=Approved");
        var submitted = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders?status=submitted");

        Assert.Equal([b.Id], approved!.Select(o => o.Id));
        Assert.Equal([a.Id], submitted!.Select(o => o.Id));
    }

    [Fact]
    public async Task S11_Unknown_status_filter_returns_400()
    {
        var response = await _client.GetAsync("/api/orders?status=Bogus");
        await ValidationProblem(response);
    }

    [Fact]
    public async Task S12_Search_matches_reference_or_customer_case_insensitively()
    {
        var acme = await CreateOrder(Acme("PO-100"));
        var globex = await CreateOrder(Globex("PO-200"));

        var byCustomer = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders?search=acme");
        var byReference = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders?search=200");
        var none = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders?search=zzz");

        Assert.Equal([acme.Id], byCustomer!.Select(o => o.Id));
        Assert.Equal([globex.Id], byReference!.Select(o => o.Id));
        Assert.Empty(none!);
    }

    [Fact]
    public async Task S13_Fetch_single_order_returns_full_order_with_lines()
    {
        var created = await CreateOrder(Globex());

        var order = await _client.GetFromJsonAsync<OrderResponse>($"/api/orders/{created.Id}");

        Assert.Equal(created.Id, order!.Id);
        Assert.Equal("Globex Inc", order.CustomerName);
        Assert.Equal(2, order.Lines.Count);
        Assert.Equal("Gadget", order.Lines[0].Product);
        Assert.Equal(99.99m, order.Lines[0].UnitPrice);
        Assert.Equal(100.01m, order.Total);
    }

    [Fact]
    public async Task S13_Unknown_order_id_returns_404()
    {
        var response = await _client.GetAsync($"/api/orders/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        await Problem(response);
    }

    // ---------- Status tracking ----------

    [Fact]
    public async Task S14_Valid_transition_returns_200_and_bumps_updatedAt()
    {
        var created = await CreateOrder(Acme());

        var response = await PatchStatus(created.Id, "Approved");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.Content.ReadFromJsonAsync<OrderResponse>();
        Assert.Equal("Approved", updated!.Status);
        Assert.True(updated.UpdatedAt > updated.CreatedAt, "updatedAt should advance");
        Assert.Equal(["Shipped", "Cancelled"], updated.AllowedTransitions);

        var fetched = await _client.GetFromJsonAsync<OrderResponse>($"/api/orders/{created.Id}");
        Assert.Equal("Approved", fetched!.Status);
    }

    [Fact]
    public async Task S15_Full_happy_path_ends_Delivered()
    {
        var created = await CreateOrder(Acme());

        foreach (var next in new[] { "Approved", "Shipped", "Delivered" })
        {
            var response = await PatchStatus(created.Id, next);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        var final = await _client.GetFromJsonAsync<OrderResponse>($"/api/orders/{created.Id}");
        Assert.Equal("Delivered", final!.Status);
        Assert.Empty(final.AllowedTransitions);
    }

    [Theory]
    [InlineData("Shipped")]
    [InlineData("Delivered")]
    [InlineData("Submitted")]
    public async Task S16_Illegal_transition_from_Submitted_returns_422_and_leaves_order_unchanged(string target)
    {
        var created = await CreateOrder(Acme());

        var response = await PatchStatus(created.Id, target);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        var problem = await Problem(response);
        Assert.Contains("Submitted", problem.Detail);
        Assert.Contains(target, problem.Detail);

        var fetched = await _client.GetFromJsonAsync<OrderResponse>($"/api/orders/{created.Id}");
        Assert.Equal("Submitted", fetched!.Status);
        Assert.Equal(created.UpdatedAt, fetched.UpdatedAt);
    }

    [Fact]
    public async Task S16_Delivered_order_cannot_change()
    {
        var created = await CreateOrder(Acme());
        foreach (var next in new[] { "Approved", "Shipped", "Delivered" }) await PatchStatus(created.Id, next);

        foreach (var target in new[] { "Submitted", "Approved", "Shipped", "Cancelled" })
        {
            var response = await PatchStatus(created.Id, target);
            Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        }
    }

    [Theory]
    [InlineData("")]
    [InlineData("Approved")]
    public async Task S17_Cancel_from_Submitted_or_Approved_is_terminal(string priorSteps)
    {
        var created = await CreateOrder(Acme());
        foreach (var step in priorSteps.Split(',', StringSplitOptions.RemoveEmptyEntries)) await PatchStatus(created.Id, step);

        var cancel = await PatchStatus(created.Id, "Cancelled");
        Assert.Equal(HttpStatusCode.OK, cancel.StatusCode);
        var cancelled = await cancel.Content.ReadFromJsonAsync<OrderResponse>();
        Assert.Equal("Cancelled", cancelled!.Status);
        Assert.Empty(cancelled.AllowedTransitions);

        var again = await PatchStatus(created.Id, "Approved");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, again.StatusCode);
    }

    [Fact]
    public async Task S23_Shipped_order_can_be_marked_LostInTransit_and_becomes_terminal()
    {
        var created = await CreateOrder(Acme());
        await PatchStatus(created.Id, "Approved");
        var shipped = (await (await PatchStatus(created.Id, "Shipped")).Content.ReadFromJsonAsync<OrderResponse>())!;
        Assert.Equal(["Delivered", "LostInTransit"], shipped.AllowedTransitions);

        var response = await PatchStatus(created.Id, "LostInTransit");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var lost = await response.Content.ReadFromJsonAsync<OrderResponse>();
        Assert.Equal("LostInTransit", lost!.Status);
        Assert.Empty(lost.AllowedTransitions);
        Assert.Equal(["Submitted", "Approved", "Shipped", "LostInTransit"], lost.StatusHistory.Select(h => h.Status));

        foreach (var target in new[] { "Shipped", "Delivered", "Cancelled", "Submitted" })
        {
            Assert.Equal(HttpStatusCode.UnprocessableEntity, (await PatchStatus(created.Id, target)).StatusCode);
        }
    }

    [Theory]
    [InlineData("")]
    [InlineData("Approved")]
    public async Task S23_LostInTransit_is_rejected_before_shipping(string steps)
    {
        var created = await CreateOrder(Acme());
        foreach (var step in steps.Split(',', StringSplitOptions.RemoveEmptyEntries)) await PatchStatus(created.Id, step);

        var response = await PatchStatus(created.Id, "LostInTransit");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task S23_List_can_filter_LostInTransit()
    {
        var a = await CreateOrder(Acme("PO-1"));
        await CreateOrder(Acme("PO-2"));
        foreach (var step in new[] { "Approved", "Shipped", "LostInTransit" }) await PatchStatus(a.Id, step);

        var lost = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders?status=lostintransit");

        Assert.Equal([a.Id], lost!.Select(o => o.Id));
    }

    [Fact]
    public async Task S18_Unknown_status_value_returns_400()
    {
        var created = await CreateOrder(Acme());

        var response = await PatchStatus(created.Id, "Lost");

        var problem = await ValidationProblem(response);
        Assert.Contains("status", problem.Errors.Keys);
    }

    [Fact]
    public async Task S19_Status_change_on_unknown_order_returns_404()
    {
        var response = await PatchStatus(Guid.NewGuid(), "Approved");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task S22_Response_includes_status_history_that_grows_with_each_transition()
    {
        var created = await CreateOrder(Acme());
        var first = Assert.Single(created.StatusHistory);
        Assert.Equal("Submitted", first.Status);
        Assert.Equal(created.CreatedAt, first.ChangedAt);

        await PatchStatus(created.Id, "Approved");
        var approved = (await (await PatchStatus(created.Id, "Shipped")).Content.ReadFromJsonAsync<OrderResponse>())!;

        Assert.Equal(["Submitted", "Approved", "Shipped"], approved.StatusHistory.Select(h => h.Status));
        Assert.True(approved.StatusHistory[1].ChangedAt > approved.StatusHistory[0].ChangedAt);
        Assert.True(approved.StatusHistory[2].ChangedAt > approved.StatusHistory[1].ChangedAt);
        Assert.Equal(approved.UpdatedAt, approved.StatusHistory[2].ChangedAt);

        // Persisted, not just computed for the response.
        var fetched = await _client.GetFromJsonAsync<OrderResponse>($"/api/orders/{created.Id}");
        Assert.Equal(3, fetched!.StatusHistory.Count);

        // A rejected transition leaves the history alone.
        await PatchStatus(created.Id, "Approved");
        fetched = await _client.GetFromJsonAsync<OrderResponse>($"/api/orders/{created.Id}");
        Assert.Equal(3, fetched!.StatusHistory.Count);
    }

    [Fact]
    public async Task S22_List_responses_include_history_too()
    {
        var created = await CreateOrder(Acme());
        await PatchStatus(created.Id, "Cancelled");

        var all = await _client.GetFromJsonAsync<List<OrderResponse>>("/api/orders");

        Assert.Equal(["Submitted", "Cancelled"], Assert.Single(all!).StatusHistory.Select(h => h.Status));
    }

    // ---------- Operability ----------

    [Fact]
    public async Task S20_Health_endpoint_returns_Healthy()
    {
        var response = await _client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Json_uses_camelCase_and_string_status()
    {
        var created = await CreateOrder(Acme());
        var json = await _client.GetStringAsync($"/api/orders/{created.Id}");

        using var doc = JsonDocument.Parse(json);
        Assert.Equal("Submitted", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal("PO-100", doc.RootElement.GetProperty("clientReference").GetString());
        Assert.Equal(JsonValueKind.Array, doc.RootElement.GetProperty("allowedTransitions").ValueKind);
    }
}
