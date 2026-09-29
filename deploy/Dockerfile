# All-in-one image for hosted demos (Render, Fly, any Docker host):
# Legacy ASP.NET API + Python analytics bridge (serves the UI) + PowerShell AttackSim, one container.
# Local development still uses ./scripts/start-demo.sh.

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS legacy-build
WORKDIR /src
COPY legacy/ .
RUN dotnet publish -c Release -o /out

FROM mcr.microsoft.com/dotnet/aspnet:8.0
ARG TARGETARCH
ARG PWSH_VERSION=7.4.6

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && case "$TARGETARCH" in arm64) PWSH_ARCH=arm64 ;; *) PWSH_ARCH=x64 ;; esac \
 && mkdir -p /opt/pwsh \
 && curl -fsSL "https://github.com/PowerShell/PowerShell/releases/download/v${PWSH_VERSION}/powershell-${PWSH_VERSION}-linux-${PWSH_ARCH}.tar.gz" \
    | tar -xz -C /opt/pwsh \
 && chmod +x /opt/pwsh/pwsh \
 && ln -s /opt/pwsh/pwsh /usr/local/bin/pwsh

WORKDIR /app
COPY bridge/requirements.txt bridge/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r bridge/requirements.txt

COPY --from=legacy-build /out /app/legacy
COPY bridge/ /app/bridge/
COPY dashboard/ /app/dashboard/
COPY chaos/ /app/chaos/
COPY deploy/entrypoint.sh /app/deploy/entrypoint.sh
RUN chmod +x /app/deploy/entrypoint.sh && mkdir -p /app/data

ENV DATA_DIR=/app/data \
    DASHBOARD_DIR=/app/dashboard \
    LEGACY_API_URL=http://127.0.0.1:5080 \
    PORT=8000
EXPOSE 8000
CMD ["/app/deploy/entrypoint.sh"]
