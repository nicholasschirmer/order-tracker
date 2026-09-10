namespace OrderTracker.Api.Domain;

public class OrderLine
{
    public int Id { get; set; }
    public Guid OrderId { get; set; }
    public required string Product { get; set; }
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }

    public decimal LineTotal => Quantity * UnitPrice;
}
