import os
import asyncio
import random
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from prisma import Prisma
from pydantic import BaseModel

DATABASE_URL = os.getenv("DATABASE_URL", "")
INTERVAL = int(os.getenv("METRICS_INTERVAL_SECONDS", "3"))
SERVICES_COUNT = int(os.getenv("SEED_SERVICES_COUNT", "8"))

db = Prisma()

app = FastAPI(title="Observability API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class InjectIncidentBody(BaseModel):
    service_name: str
    severity: str = "warning"
    duration_seconds: int = 45


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def compute_health_score(m) -> int:
    score = 100.0
    score -= (m.cpu / 100.0) * 25.0
    score -= (m.memory / 100.0) * 20.0
    score -= clamp(m.latencyMs / 500.0, 0, 1) * 25.0
    score -= clamp(m.errorRate / 10.0, 0, 1) * 25.0
    return int(clamp(score, 0, 100))


def label_from_score(score: int) -> str:
    if score >= 80:
        return "Healthy"
    if score >= 50:
        return "Degraded"
    return "Critical"


@app.on_event("startup")
async def startup():
    await db.connect()
    await seed_services()
    app.state.generator_task = asyncio.create_task(metrics_generator_loop())


@app.on_event("shutdown")
async def shutdown():
    task = getattr(app.state, "generator_task", None)
    if task:
        task.cancel()
    await db.disconnect()


async def seed_services():
    existing = await db.service.count()
    if existing > 0:
        return

    for i in range(1, SERVICES_COUNT + 1):
        await db.service.create(data={"name": f"service-{i:02d}"})


INCIDENTS = {}


async def metrics_generator_loop():
    while True:
        try:
            services = await db.service.find_many()
            now = datetime.now(timezone.utc)

            for s in services:
                cpu = random.gauss(35, 12)
                mem = random.gauss(45, 10)
                lat = random.gauss(120, 40)
                err = abs(random.gauss(0.6, 0.4))
                uptime = random.gauss(99.7, 0.1)

                inc = INCIDENTS.get(s.name)
                if inc:
                    until_dt, severity = inc
                    if now <= until_dt:
                        if severity == "critical":
                            cpu += random.uniform(20, 40)
                            mem += random.uniform(15, 30)
                            lat += random.uniform(250, 450)
                            err += random.uniform(4, 8)
                            uptime -= random.uniform(0.2, 1.0)
                        else:
                            cpu += random.uniform(10, 20)
                            mem += random.uniform(8, 15)
                            lat += random.uniform(120, 250)
                            err += random.uniform(1.5, 4.0)
                            uptime -= random.uniform(0.05, 0.3)
                    else:
                        INCIDENTS.pop(s.name, None)

                cpu = clamp(cpu, 0, 100)
                mem = clamp(mem, 0, 100)
                lat = clamp(lat, 20, 1200)
                err = clamp(err, 0, 15)
                uptime = clamp(uptime, 95, 100)

                metric = await db.metric.create(
                    data={
                        "serviceId": s.id,
                        "timestamp": now,
                        "cpu": cpu,
                        "memory": mem,
                        "latencyMs": lat,
                        "errorRate": err,
                        "uptimePct": uptime,
                    }
                )

                level = None
                msg = None

                if metric.errorRate >= 5 or metric.latencyMs >= 600:
                    level = "critical"
                    msg = "High error rate or latency"
                elif metric.errorRate >= 2 or metric.latencyMs >= 350:
                    level = "warning"
                    msg = "Elevated error rate or latency"

                if level and msg:
                    await db.alert.create(
                        data={
                            "serviceId": s.id,
                            "level": level,
                            "message": msg,
                            "isActive": True,
                        }
                    )

            await asyncio.sleep(INTERVAL)

        except asyncio.CancelledError:
            return
        except Exception:
            await asyncio.sleep(1)


@app.get("/services")
async def list_services():
    services = await db.service.find_many(order={"name": "asc"})
    return [{"id": s.id, "name": s.name} for s in services]


@app.get("/metrics/latest")
async def latest_metrics():
    services = await db.service.find_many(order={"name": "asc"})
    out = []

    for s in services:
        m = await db.metric.find_first(
            where={"serviceId": s.id},
            order={"timestamp": "desc"},
        )

        if not m:
            continue

        score = compute_health_score(m)

        out.append({
            "service": s.name,
            "timestamp": m.timestamp,
            "cpu": m.cpu,
            "memory": m.memory,
            "latencyMs": m.latencyMs,
            "errorRate": m.errorRate,
            "uptimePct": m.uptimePct,
            "healthScore": score,
            "healthLabel": label_from_score(score),
        })

    return out


@app.get("/metrics/history")
async def metrics_history(
    service: str = Query(..., description="service name"),
    minutes: int = Query(60, ge=5, le=24*60)
):
    s = await db.service.find_unique(where={"name": service})

    if not s:
        return {"service": service, "points": []}

    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)

    points = await db.metric.find_many(
        where={"serviceId": s.id, "timestamp": {"gte": since}},
        order={"timestamp": "asc"},
        take=5000,
    )

    return {
        "service": service,
        "points": [
            {
                "t": p.timestamp,
                "cpu": p.cpu,
                "memory": p.memory,
                "latencyMs": p.latencyMs,
                "errorRate": p.errorRate,
                "uptimePct": p.uptimePct,
            }
            for p in points
        ],
    }


@app.post("/incident/inject")
async def inject_incident(body: InjectIncidentBody):
    until_dt = datetime.now(timezone.utc) + timedelta(seconds=body.duration_seconds)
    sev = "critical" if body.severity == "critical" else "warning"

    INCIDENTS[body.service_name] = (until_dt, sev)

    return {
        "ok": True,
        "service": body.service_name,
        "severity": sev,
        "until": until_dt
    }