using Microsoft.EntityFrameworkCore;
using OrderTracker.Api.Data;
using OrderTracker.Api.Endpoints;
using OrderTracker.Api.Services;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Orders") ?? "Data Source=orders.db";

builder.Services.AddDbContext<OrderDbContext>(options => options.UseSqlite(connectionString));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<OrderService>();
builder.Services.AddProblemDetails();
builder.Services.AddHealthChecks();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins("http://localhost:4200").AllowAnyHeader().AllowAnyMethod().WithExposedHeaders(OrderEndpoints.ReplayHeader, "Location")));

var app = builder.Build();

// Demo-scale schema management: create the schema on first run.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<OrderDbContext>();
    db.Database.EnsureCreated();
    // WAL lets readers proceed while a writer holds the lock, which keeps concurrent
    // submissions (scenario S05) from tripping over "database is locked".
    db.Database.ExecuteSqlRaw("PRAGMA journal_mode=WAL;");

    // `dotnet run -- --seed 250` fills the database with demo orders and exits.
    var seedIndex = Array.IndexOf(args, "--seed");
    if (seedIndex >= 0)
    {
        var count = seedIndex + 1 < args.Length && int.TryParse(args[seedIndex + 1], out var n) ? n : 200;
        var added = DataSeeder.Seed(db, count);
        Console.WriteLine($"Seeded {added} new order(s); database now holds {db.Orders.Count()}.");
        return;
    }
}

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseCors();

app.MapHealthChecks("/health");
app.MapOrderEndpoints();

app.Run();

/// <summary>Exposes the entry point to WebApplicationFactory in the test project.</summary>
public partial class Program { }
