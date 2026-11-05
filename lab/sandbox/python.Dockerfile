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

# Packages for claims/real/parkinsons-spread, kept as files only, not installed. Nothing changes for
# other claims; that claim's own pip install finds them here instead of downloading on a bad connection.
RUN pip download --no-cache-dir --retries 10 --timeout 120 -d /opt/wheels \
    numpy==1.26.4 \
    pandas==1.5.3 \
    scipy==1.11.4 \
    statsmodels==0.14.1 \
    matplotlib==3.8.4 \
    seaborn==0.12.2 \
    tqdm==4.67.1

ENV PIP_FIND_LINKS=/opt/wheels

# For installing a repository's packages as of its commit date, which needs a Python from that era.
RUN pip install --no-cache-dir uv==0.9.5 \
    && UV_PYTHON_INSTALL_DIR=/opt/uv-python uv python install 3.8 3.9 3.10

ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python

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
