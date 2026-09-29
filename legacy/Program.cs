var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:5080");

builder.Services.AddCors(options =>
{
    options.AddPolicy("Bridge", policy =>
        policy.WithOrigins("http://127.0.0.1:8000", "http://localhost:8000")
            .AllowAnyHeader());
});

var app = builder.Build();
app.UseCors("Bridge");

var rng = Random.Shared;
var extraSources = new[] { "10.0.0.12", "172.16.4.88", "45.33.22.11", "192.168.1.50" };
var extraEvents = new[] { "Login Attempt", "SSH Connection", "File Access", "DNS Query", "Admin Escalation" };
var statuses = new[] { "Success", "Failed", "Denied", "Blocked" };

app.MapGet("/api/raw-logs", (string? jitter) =>
{
    var useJitter = string.Equals(jitter, "1", StringComparison.OrdinalIgnoreCase)
        || string.Equals(jitter, "true", StringComparison.OrdinalIgnoreCase);
    var now = DateTime.Now;
    var logs = new[]
    {
        new
        {
            Timestamp = now,
            Source = useJitter ? extraSources[rng.Next(extraSources.Length)] : "192.168.1.1",
            Event = useJitter ? extraEvents[rng.Next(extraEvents.Length)] : "Login Attempt",
            Status = useJitter ? statuses[rng.Next(statuses.Length)] : "Success"
        },
        new
        {
            Timestamp = now.AddSeconds(-5),
            Source = "45.33.22.11",
            Event = "SSH Connection",
            Status = "Failed"
        },
        new
        {
            Timestamp = now.AddSeconds(-10),
            Source = "10.0.0.5",
            Event = "File Access",
            Status = "Denied"
        }
    };
    return Results.Ok(logs);
});

app.Run();
