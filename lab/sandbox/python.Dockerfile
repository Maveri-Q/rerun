# Sandbox for untrusted research code, runtime "python3.11".
# No secrets are ever mounted. The orchestrator starts one short-lived container per phase
# with network, CPU, memory and PID limits (see lab/orchestrator/src/sandbox/docker.ts).
FROM python:3.11-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    numpy==2.2.6 \
    pandas==2.3.3 \
    scipy==1.15.3 \
    scikit-learn==1.7.2 \
    statsmodels==0.14.5 \
    matplotlib==3.10.7 \
    nbconvert==7.16.6 \
    nbclient==0.10.2 \
    ipykernel==6.31.0

RUN useradd --create-home --uid 1000 runner \
    && mkdir /work \
    && chown runner:runner /work

ENV MPLBACKEND=Agg \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_USER=1 \
    PYTHONUSERBASE=/work/.pydeps \
    PATH=/work/.pydeps/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    HOME=/work/.home

USER runner
WORKDIR /work
