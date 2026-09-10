namespace OrderTracker.Api.Domain;

/// <summary>
/// Client references are typed by hand, so the idempotency key is compared after trimming
/// whitespace and upper-casing. The original text is kept for display.
/// </summary>
public static class ReferenceNormalizer
{
    public static string Normalize(string reference) => reference.Trim().ToUpperInvariant();
}
