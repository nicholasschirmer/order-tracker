using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using OrderTracker.Api.Domain;

namespace OrderTracker.Api.Data;

public class OrderDbContext(DbContextOptions<OrderDbContext> options) : DbContext(options)
{
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderLine> OrderLines => Set<OrderLine>();
    public DbSet<OrderStatusChange> OrderStatusChanges => Set<OrderStatusChange>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // SQLite cannot ORDER BY / compare DateTimeOffset, so timestamps are stored as UTC ticks.
        var utcTicks = new ValueConverter<DateTimeOffset, long>(
            v => v.UtcTicks,
            v => new DateTimeOffset(v, TimeSpan.Zero));

        modelBuilder.Entity<Order>(e =>
        {
            e.HasKey(o => o.Id);
            e.Property(o => o.CreatedAt).HasConversion(utcTicks);
            e.Property(o => o.UpdatedAt).HasConversion(utcTicks);
            e.Property(o => o.ClientReference).HasMaxLength(64).IsRequired();
            e.Property(o => o.NormalizedReference).HasMaxLength(64).IsRequired();
            // The hard guarantee against duplicates, independent of application logic.
            e.HasIndex(o => o.NormalizedReference).IsUnique();
            e.Property(o => o.CustomerName).HasMaxLength(200).IsRequired();
            e.Property(o => o.Status).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(o => o.CreatedAt);
            e.HasMany(o => o.Lines).WithOne().HasForeignKey(l => l.OrderId).OnDelete(DeleteBehavior.Cascade);
            e.Navigation(o => o.Lines).AutoInclude();
            e.HasMany(o => o.StatusHistory).WithOne().HasForeignKey(h => h.OrderId).OnDelete(DeleteBehavior.Cascade);
            e.Navigation(o => o.StatusHistory).AutoInclude();
            e.Ignore(o => o.Total);
        });

        modelBuilder.Entity<OrderStatusChange>(e =>
        {
            e.HasKey(h => h.Id);
            e.Property(h => h.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(h => h.ChangedAt).HasConversion(utcTicks);
            e.HasIndex(h => new { h.OrderId, h.ChangedAt });
        });

        modelBuilder.Entity<OrderLine>(e =>
        {
            e.HasKey(l => l.Id);
            e.Property(l => l.Product).HasMaxLength(200).IsRequired();
            e.Property(l => l.UnitPrice).HasPrecision(18, 4);
            e.Ignore(l => l.LineTotal);
        });
    }
}
