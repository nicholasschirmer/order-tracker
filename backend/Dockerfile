# syntax=docker/dockerfile:1
# ---- build ----------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore first so the NuGet layer is cached until a project file changes.
COPY Directory.Build.props ./
COPY src/OrderTracker.Api/OrderTracker.Api.csproj src/OrderTracker.Api/
RUN dotnet restore src/OrderTracker.Api/OrderTracker.Api.csproj

COPY src/ src/
RUN dotnet publish src/OrderTracker.Api/OrderTracker.Api.csproj \
    -c Release -o /app/publish --no-restore /p:UseAppHost=false

# ---- runtime --------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# SQLite database lives on a volume so it survives container replacement.
ENV ASPNETCORE_HTTP_PORTS=8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    ConnectionStrings__Orders="Data Source=/data/orders.db"
RUN mkdir -p /data && chown app:app /data
VOLUME ["/data"]

COPY --from=build /app/publish ./
USER app
EXPOSE 8080

# The aspnet image has no curl; use bash's /dev/tcp to poll /health.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 && printf 'GET /health HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n' >&3 && grep -q Healthy <&3"]

# Extra args pass straight to the app, e.g. `docker run ... --seed 200`.
ENTRYPOINT ["dotnet", "OrderTracker.Api.dll"]
