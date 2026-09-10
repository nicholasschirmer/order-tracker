using OrderTracker.Api.Domain;

namespace OrderTracker.Api.Tests.Domain;

/// <summary>
/// Pure domain rules: status state machine, totals and reference normalisation.
/// Scenario ids refer to docs/scenarios.md.
/// </summary>
public class OrderTests
{
    private static readonly DateTimeOffset T0 = new(2026, 9, 10, 9, 0, 0, TimeSpan.Zero);

    private static Order NewOrder() =>
        Order.Create("PO-100", "Acme Ltd",
            [new OrderLine { Product = "Widget", Quantity = 10, UnitPrice = 2.50m }], T0);

    [Fact]
    public void Create_starts_in_Submitted_with_computed_total()
    {
        var order = NewOrder();

        Assert.Equal(OrderStatus.Submitted, order.Status);
        Assert.Equal(25.00m, order.Total);
        Assert.Equal(T0, order.CreatedAt);
        Assert.Equal(T0, order.UpdatedAt);
        Assert.NotEqual(Guid.Empty, order.Id);
    }

    [Fact]
    public void S04_Create_normalises_reference_but_keeps_original_text()
    {
        var order = Order.Create("  po-100 ", "Acme Ltd",
            [new OrderLine { Product = "Widget", Quantity = 1, UnitPrice = 1m }], T0);

        Assert.Equal("po-100", order.ClientReference);
        Assert.Equal("PO-100", order.NormalizedReference);
    }

    [Theory]
    [InlineData(OrderStatus.Submitted, OrderStatus.Approved)]
    [InlineData(OrderStatus.Submitted, OrderStatus.Cancelled)]
    [InlineData(OrderStatus.Approved, OrderStatus.Shipped)]
    [InlineData(OrderStatus.Approved, OrderStatus.Cancelled)]
    [InlineData(OrderStatus.Shipped, OrderStatus.Delivered)]
    [InlineData(OrderStatus.Shipped, OrderStatus.LostInTransit)]
    public void S14_S17_Legal_transitions_succeed_and_bump_UpdatedAt(OrderStatus from, OrderStatus to)
    {
        var order = NewOrder();
        Advance(order, from);
        var later = T0.AddMinutes(5);

        order.TransitionTo(to, later);

        Assert.Equal(to, order.Status);
        Assert.Equal(later, order.UpdatedAt);
    }

    [Theory]
    [InlineData(OrderStatus.Submitted, OrderStatus.Shipped)]
    [InlineData(OrderStatus.Submitted, OrderStatus.Delivered)]
    [InlineData(OrderStatus.Submitted, OrderStatus.Submitted)]
    [InlineData(OrderStatus.Approved, OrderStatus.Submitted)]
    [InlineData(OrderStatus.Approved, OrderStatus.Delivered)]
    [InlineData(OrderStatus.Shipped, OrderStatus.Cancelled)]
    [InlineData(OrderStatus.Shipped, OrderStatus.Approved)]
    [InlineData(OrderStatus.Delivered, OrderStatus.Submitted)]
    [InlineData(OrderStatus.Delivered, OrderStatus.Cancelled)]
    [InlineData(OrderStatus.Cancelled, OrderStatus.Submitted)]
    [InlineData(OrderStatus.Cancelled, OrderStatus.Approved)]
    [InlineData(OrderStatus.Submitted, OrderStatus.LostInTransit)]
    [InlineData(OrderStatus.Approved, OrderStatus.LostInTransit)]
    [InlineData(OrderStatus.Delivered, OrderStatus.LostInTransit)]
    [InlineData(OrderStatus.LostInTransit, OrderStatus.Shipped)]
    [InlineData(OrderStatus.LostInTransit, OrderStatus.Delivered)]
    [InlineData(OrderStatus.LostInTransit, OrderStatus.Cancelled)]
    public void S16_Illegal_transitions_throw_and_leave_order_unchanged(OrderStatus from, OrderStatus to)
    {
        var order = NewOrder();
        Advance(order, from);
        var before = order.UpdatedAt;

        var ex = Assert.Throws<InvalidStatusTransitionException>(() => order.TransitionTo(to, T0.AddHours(1)));

        Assert.Equal(from, ex.From);
        Assert.Equal(to, ex.To);
        Assert.Equal(from, order.Status);
        Assert.Equal(before, order.UpdatedAt);
    }

    [Fact]
    public void S16_AllowedTransitions_lists_only_legal_next_states()
    {
        var order = NewOrder();
        Assert.Equal([OrderStatus.Approved, OrderStatus.Cancelled], order.AllowedTransitions());

        Advance(order, OrderStatus.Approved);
        Assert.Equal([OrderStatus.Shipped, OrderStatus.Cancelled], order.AllowedTransitions());

        Advance(order, OrderStatus.Shipped);
        Assert.Equal([OrderStatus.Delivered, OrderStatus.LostInTransit], order.AllowedTransitions());

        Advance(order, OrderStatus.Delivered);
        Assert.Empty(order.AllowedTransitions());
    }

    [Fact]
    public void S17_Cancelled_is_terminal()
    {
        var order = NewOrder();
        order.TransitionTo(OrderStatus.Cancelled, T0.AddMinutes(1));

        Assert.Empty(order.AllowedTransitions());
        Assert.Throws<InvalidStatusTransitionException>(() => order.TransitionTo(OrderStatus.Approved, T0.AddMinutes(2)));
    }

    [Fact]
    public void S23_Shipped_order_can_be_marked_lost_in_transit_and_is_then_terminal()
    {
        var order = NewOrder();
        Advance(order, OrderStatus.Shipped);

        order.TransitionTo(OrderStatus.LostInTransit, T0.AddDays(3));

        Assert.Equal(OrderStatus.LostInTransit, order.Status);
        Assert.Empty(order.AllowedTransitions());
        Assert.Equal(OrderStatus.LostInTransit, order.StatusHistory.Last().Status);
    }

    [Theory]
    [InlineData("PO-100", "PO-100")]
    [InlineData("  po-100 ", "PO-100")]
    [InlineData("\tPo-100\n", "PO-100")]
    public void S04_ReferenceNormalizer_trims_and_uppercases(string input, string expected)
    {
        Assert.Equal(expected, ReferenceNormalizer.Normalize(input));
    }

    [Fact]
    public void HasSamePayload_ignores_case_and_whitespace_but_not_values()
    {
        var order = NewOrder();

        Assert.True(order.HasSamePayload(" acme ltd ",
            [new OrderLine { Product = " widget", Quantity = 10, UnitPrice = 2.50m }]));

        Assert.False(order.HasSamePayload("Globex Inc",
            [new OrderLine { Product = "Widget", Quantity = 10, UnitPrice = 2.50m }]));

        Assert.False(order.HasSamePayload("Acme Ltd",
            [new OrderLine { Product = "Widget", Quantity = 11, UnitPrice = 2.50m }]));

        Assert.False(order.HasSamePayload("Acme Ltd",
            [new OrderLine { Product = "Widget", Quantity = 10, UnitPrice = 2.50m },
             new OrderLine { Product = "Gadget", Quantity = 1, UnitPrice = 1m }]));
    }

    [Fact]
    public void S22_Create_records_Submitted_as_the_first_history_entry()
    {
        var order = NewOrder();

        var entry = Assert.Single(order.StatusHistory);
        Assert.Equal(OrderStatus.Submitted, entry.Status);
        Assert.Equal(T0, entry.ChangedAt);
    }

    [Fact]
    public void S22_Each_transition_appends_a_history_entry_in_order()
    {
        var order = NewOrder();
        order.TransitionTo(OrderStatus.Approved, T0.AddHours(1));
        order.TransitionTo(OrderStatus.Shipped, T0.AddHours(5));
        order.TransitionTo(OrderStatus.Delivered, T0.AddDays(2));

        Assert.Equal(
            [OrderStatus.Submitted, OrderStatus.Approved, OrderStatus.Shipped, OrderStatus.Delivered],
            order.StatusHistory.Select(h => h.Status));
        Assert.Equal(
            [T0, T0.AddHours(1), T0.AddHours(5), T0.AddDays(2)],
            order.StatusHistory.Select(h => h.ChangedAt));
    }

    [Fact]
    public void S22_Illegal_transition_does_not_touch_history()
    {
        var order = NewOrder();
        Assert.Throws<InvalidStatusTransitionException>(() => order.TransitionTo(OrderStatus.Shipped, T0.AddHours(1)));
        Assert.Single(order.StatusHistory);
    }

    /// <summary>The legal route from <c>Submitted</c> to each status, used to put an order into a given state.</summary>
    private static readonly Dictionary<OrderStatus, OrderStatus[]> PathTo = new()
    {
        [OrderStatus.Submitted] = [],
        [OrderStatus.Approved] = [OrderStatus.Approved],
        [OrderStatus.Shipped] = [OrderStatus.Approved, OrderStatus.Shipped],
        [OrderStatus.Delivered] = [OrderStatus.Approved, OrderStatus.Shipped, OrderStatus.Delivered],
        [OrderStatus.Cancelled] = [OrderStatus.Cancelled],
        [OrderStatus.LostInTransit] = [OrderStatus.Approved, OrderStatus.Shipped, OrderStatus.LostInTransit],
    };

    /// <summary>Walks the order along its legal route until it reaches <paramref name="target"/>, skipping steps already taken.</summary>
    private static void Advance(Order order, OrderStatus target)
    {
        var visited = order.StatusHistory.Select(h => h.Status).ToHashSet();
        foreach (var step in PathTo[target].Where(s => !visited.Contains(s)))
        {
            order.TransitionTo(step, T0);
        }
    }
}
