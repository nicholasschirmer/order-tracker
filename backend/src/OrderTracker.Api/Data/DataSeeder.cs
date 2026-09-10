using OrderTracker.Api.Domain;

namespace OrderTracker.Api.Data;

/// <summary>
/// Generates realistic demo orders. Everything goes through the domain model (Order.Create /
/// TransitionTo) so every seeded order obeys the same invariants as a real one; only the clock is
/// faked so orders are spread over the past 90 days.
/// Deterministic for a given <c>randomSeed</c>. Existing references are never duplicated.
/// </summary>
public static class DataSeeder
{
    private static readonly string[] Customers =
    [
        "Acme Ltd", "Globex Inc", "Initech", "Umbrella Corp", "Stark Industries", "Wayne Enterprises",
        "Wonka Industries", "Soylent Corp", "Hooli", "Pied Piper", "Vandelay Industries", "Cyberdyne Systems",
        "Tyrell Corporation", "Massive Dynamic", "Sirius Cybernetics", "Aperture Science", "Black Mesa",
        "Oscorp", "Dunder Mifflin", "Prestige Worldwide", "Bluth Company", "Gekko & Co", "Sterling Cooper",
        "Los Pollos Hermanos", "Nakatomi Trading", "Weyland-Yutani", "Buy n Large", "Monarch Solutions",
    ];

    private static readonly (string Product, decimal BasePrice)[] Catalogue =
    [
        ("Widget", 2.50m), ("Widget XL", 4.75m), ("Gadget", 99.99m), ("Gizmo", 0.01m), ("Sprocket", 12.40m),
        ("Flux capacitor", 1499.00m), ("Hex bolt M8 (box of 100)", 18.90m), ("Steel bracket", 6.25m),
        ("Copper wire 2.5mm (100m)", 84.00m), ("Control panel", 325.00m), ("Pressure sensor", 47.30m),
        ("Hydraulic pump", 1180.00m), ("Conveyor belt 10m", 640.00m), ("Safety helmet", 22.00m),
        ("Hi-vis vest", 9.50m), ("Toolbox (empty)", 39.00m), ("Cordless drill", 129.00m), ("Drill bit set", 24.50m),
        ("Industrial fan", 289.00m), ("LED floodlight 50W", 34.90m), ("Pallet (wood)", 15.00m),
        ("Shrink wrap roll", 11.20m), ("Label printer", 219.00m), ("Barcode scanner", 89.00m),
        ("Rubber gasket 50mm", 1.15m), ("Ball bearing 6204", 3.80m), ("Lubricant 5L", 42.00m),
        ("Thermal paste", 7.99m), ("Server rack 42U", 1350.00m), ("Ethernet cable 5m", 4.20m),
    ];

    // Roughly how a real backlog looks: most orders finished, a healthy in-progress tail.
    private static readonly (OrderStatus Status, int Weight)[] StatusMix =
    [
        (OrderStatus.Submitted, 22), (OrderStatus.Approved, 18), (OrderStatus.Shipped, 14),
        (OrderStatus.Delivered, 34), (OrderStatus.Cancelled, 9), (OrderStatus.LostInTransit, 3),
    ];

    private const int HistoryDays = 90;

    public static int Seed(OrderDbContext db, int count, int randomSeed = 42, DateTimeOffset? now = null)
    {
        var clock = now ?? DateTimeOffset.UtcNow;
        var rng = new Random(randomSeed);
        var existing = db.Orders.Select(o => o.NormalizedReference).ToHashSet();
        var year = clock.Year;
        var added = 0;

        // References follow a fixed sequence, so seeding 200 then 500 yields 500 orders total:
        // already-present references are skipped, new ones filled in.
        for (var sequence = 1; sequence <= count; sequence++)
        {
            var reference = $"PO-{year}-{sequence:D4}";
            // Draw the order's random values even when skipping so re-runs stay deterministic.
            var order = BuildOrder(reference, rng, clock);
            if (existing.Contains(order.NormalizedReference)) continue;

            db.Orders.Add(order);
            existing.Add(order.NormalizedReference);
            added++;
            if (added % 100 == 0) db.SaveChanges();
        }

        db.SaveChanges();
        return added;
    }

    private static Order BuildOrder(string reference, Random rng, DateTimeOffset clock)
    {
        var customer = Customers[rng.Next(Customers.Length)];
        var lineCount = WeightedLineCount(rng);
        var picks = Enumerable.Range(0, Catalogue.Length).OrderBy(_ => rng.Next()).Take(lineCount);
        var lines = picks.Select(i =>
        {
            var (product, basePrice) = Catalogue[i];
            // ±10% negotiated price, rounded to cents; quantities skew small with occasional bulk orders.
            var price = Math.Round(basePrice * (decimal)(0.9 + rng.NextDouble() * 0.2), 2);
            var quantity = rng.Next(10) == 0 ? rng.Next(50, 1000) : rng.Next(1, 25);
            return new OrderLine { Product = product, Quantity = quantity, UnitPrice = price };
        }).ToList();

        // Created anywhere in the last 90 days, during working hours.
        var daysAgo = rng.NextDouble() * HistoryDays;
        var createdAt = clock.AddDays(-daysAgo).Date.AddHours(8 + rng.NextDouble() * 9);
        if (createdAt > clock.UtcDateTime) createdAt = clock.UtcDateTime.AddMinutes(-rng.Next(1, 120));
        var created = new DateTimeOffset(createdAt, TimeSpan.Zero);

        var order = Order.Create(reference, customer, lines, created);

        var target = PickStatus(rng);
        var when = created;
        var remaining = clock - created;
        foreach (var step in PathTo(target, rng))
        {
            // Each step happens a few hours to a few days later, but never in the future.
            var maxAdvance = Math.Max(1, Math.Min(remaining.TotalHours / 2, 96));
            when = when.AddHours(1 + rng.NextDouble() * (maxAdvance - 1));
            if (when >= clock) when = clock.AddMinutes(-rng.Next(1, 30));
            if (when <= order.UpdatedAt) when = order.UpdatedAt.AddMinutes(1 + rng.Next(30));
            if (when > clock) break; // order too fresh to have progressed; leave it where it is
            remaining = clock - when;
            order.TransitionTo(step, when);
        }

        return order;
    }

    private static int WeightedLineCount(Random rng) => rng.Next(100) switch
    {
        < 40 => 1,
        < 70 => 2,
        < 85 => 3,
        < 95 => 4,
        _ => 5,
    };

    private static OrderStatus PickStatus(Random rng)
    {
        var total = StatusMix.Sum(s => s.Weight);
        var roll = rng.Next(total);
        foreach (var (status, weight) in StatusMix)
        {
            if (roll < weight) return status;
            roll -= weight;
        }
        return OrderStatus.Submitted;
    }

    private static IEnumerable<OrderStatus> PathTo(OrderStatus target, Random rng) => target switch
    {
        OrderStatus.Submitted => [],
        OrderStatus.Approved => [OrderStatus.Approved],
        OrderStatus.Shipped => [OrderStatus.Approved, OrderStatus.Shipped],
        OrderStatus.Delivered => [OrderStatus.Approved, OrderStatus.Shipped, OrderStatus.Delivered],
        OrderStatus.Cancelled => rng.Next(2) == 0 ? [OrderStatus.Cancelled] : [OrderStatus.Approved, OrderStatus.Cancelled],
        OrderStatus.LostInTransit => [OrderStatus.Approved, OrderStatus.Shipped, OrderStatus.LostInTransit],
        _ => [],
    };
}
