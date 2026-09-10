using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace OrderTracker.Api.Tests.Api;

/// <summary>
/// Boots the real API against a private SQLite file so every test class starts from an
/// empty database and tests cannot interfere with each other.
/// </summary>
public sealed class OrderTrackerFactory : WebApplicationFactory<Program>
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"order-tracker-test-{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Orders", $"Data Source={_dbPath}");
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try { File.Delete(_dbPath + suffix); } catch { /* best effort */ }
        }
    }
}
