"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type Metric = {
  service: string;
  timestamp: string;
  cpu: number;
  memory: number;
  latencyMs: number;
  errorRate: number;
  uptimePct: number;
  healthScore: number;
  healthLabel: string;
};

type HistoryPoint = {
  t: string;
  cpu: number;
  memory: number;
  latencyMs: number;
  errorRate: number;
  uptimePct: number;
};

type HistoryResponse = {
  service: string;
  points: HistoryPoint[];
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

function getHealthColor(label: string) {
  if (label === "Healthy") return "#16a34a";
  if (label === "Degraded") return "#ca8a04";
  return "#dc2626";
}

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 18,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#111827" }}>{value}</div>
      {subtitle && <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 6 }}>{subtitle}</div>}
    </div>
  );
}

export default function Home() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [injectService, setInjectService] = useState("service-01");
  const [injectSeverity, setInjectSeverity] = useState<"warning" | "critical">("warning");
  const [injecting, setInjecting] = useState(false);
  const [selectedService, setSelectedService] = useState("service-01");

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/metrics/latest`, { cache: "no-store" });
      const data = await res.json();
      setMetrics(data);

      if (data.length > 0) {
        const hasCurrentSelected = data.some((m: Metric) => m.service === selectedService);
        if (!hasCurrentSelected) {
          setSelectedService(data[0].service);
        }
      }
    } catch (error) {
      console.error("Failed to load metrics:", error);
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory(service: string) {
    try {
      setHistoryLoading(true);
      const res = await fetch(
        `${API_BASE}/metrics/history?service=${encodeURIComponent(service)}&minutes=60`,
        { cache: "no-store" }
      );
      const data: HistoryResponse = await res.json();
      setHistory(data.points ?? []);
    } catch (error) {
      console.error("Failed to load history:", error);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function injectIncident() {
    try {
      setInjecting(true);
      await fetch(`${API_BASE}/incident/inject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          service_name: injectService,
          severity: injectSeverity,
          duration_seconds: 45,
        }),
      });
      await load();
      await loadHistory(selectedService);
    } catch (error) {
      console.error("Failed to inject incident:", error);
    } finally {
      setInjecting(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selectedService) return;
    loadHistory(selectedService);
  }, [selectedService]);

  const summary = useMemo(() => {
    const total = metrics.length;
    const healthy = metrics.filter((m) => m.healthLabel === "Healthy").length;
    const degraded = metrics.filter((m) => m.healthLabel === "Degraded").length;
    const critical = metrics.filter((m) => m.healthLabel === "Critical").length;

    const avgCpu =
      total > 0 ? metrics.reduce((sum, m) => sum + m.cpu, 0) / total : 0;

    const avgLatency =
      total > 0 ? metrics.reduce((sum, m) => sum + m.latencyMs, 0) / total : 0;

    return {
      total,
      healthy,
      degraded,
      critical,
      avgCpu,
      avgLatency,
    };
  }, [metrics]);

  const chartData = useMemo(() => {
    return history.map((point) => ({
      time: new Date(point.t).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      cpu: Number(point.cpu.toFixed(1)),
      latencyMs: Number(point.latencyMs.toFixed(0)),
      memory: Number(point.memory.toFixed(1)),
      errorRate: Number(point.errorRate.toFixed(2)),
    }));
  }, [history]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        padding: "32px 24px",
        fontFamily: "Inter, system-ui, Arial, sans-serif",
        color: "#111827",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 34, fontWeight: 800 }}>
            Infrastructure Observability Platform
          </h1>
          <p style={{ marginTop: 10, color: "#6b7280", fontSize: 15 }}>
            Production-like monitoring dashboard with simulated metrics, health scoring, alerts logic, and incident injection.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
            marginBottom: 24,
          }}
        >
          <StatCard title="Total Services" value={String(summary.total)} subtitle="Actively monitored" />
          <StatCard title="Healthy / Degraded / Critical" value={`${summary.healthy} / ${summary.degraded} / ${summary.critical}`} subtitle="Current fleet status" />
          <StatCard title="Average CPU" value={`${summary.avgCpu.toFixed(1)}%`} subtitle="Across all services" />
          <StatCard title="Average Latency" value={`${summary.avgLatency.toFixed(0)} ms`} subtitle="Current response latency" />
        </div>

        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: 16,
            padding: 18,
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            marginBottom: 24,
          }}
        >
          <div style={{ marginBottom: 14, fontSize: 18, fontWeight: 700 }}>Incident Simulation</div>

          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <select
              value={injectService}
              onChange={(e) => setInjectService(e.target.value)}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                background: "#fff",
              }}
            >
              {metrics.map((m) => (
                <option key={m.service} value={m.service}>
                  {m.service}
                </option>
              ))}
            </select>

            <select
              value={injectSeverity}
              onChange={(e) => setInjectSeverity(e.target.value as "warning" | "critical")}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                background: "#fff",
              }}
            >
              <option value="warning">warning</option>
              <option value="critical">critical</option>
            </select>

            <button
              onClick={injectIncident}
              disabled={injecting}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "none",
                background: injecting ? "#9ca3af" : "#111827",
                color: "#fff",
                fontWeight: 600,
                cursor: injecting ? "not-allowed" : "pointer",
              }}
            >
              {injecting ? "Injecting..." : "Inject Incident (45s)"}
            </button>

            <button
              onClick={async () => {
                await load();
                await loadHistory(selectedService);
              }}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                background: "#fff",
                color: "#111827",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Refresh
            </button>
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: 16,
            padding: 18,
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            marginBottom: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700 }}>Service History Charts</div>

            <select
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value)}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                background: "#fff",
                minWidth: 160,
              }}
            >
              {metrics.map((m) => (
                <option key={m.service} value={m.service}>
                  {m.service}
                </option>
              ))}
            </select>
          </div>

          {historyLoading ? (
            <div style={{ color: "#6b7280" }}>Loading chart data...</div>
          ) : chartData.length === 0 ? (
            <div style={{ color: "#6b7280" }}>No history data yet. Wait a few seconds and refresh.</div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
                gap: 20,
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>CPU Usage (%)</div>
                <div
                  style={{
                    width: "100%",
                    height: 280,
                    background: "#fff",
                    border: "1px solid #f1f5f9",
                    borderRadius: 14,
                    padding: 8,
                  }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" minTickGap={24} />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="cpu"
                        name="CPU %"
                        stroke="#2563eb"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Latency (ms)</div>
                <div
                  style={{
                    width: "100%",
                    height: 280,
                    background: "#fff",
                    border: "1px solid #f1f5f9",
                    borderRadius: 14,
                    padding: 8,
                  }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" minTickGap={24} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="latencyMs"
                        name="Latency ms"
                        stroke="#dc2626"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: 16,
            padding: 18,
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
        >
          <div style={{ marginBottom: 16, fontSize: 18, fontWeight: 700 }}>Live Service Metrics</div>

          {loading ? (
            <div style={{ color: "#6b7280" }}>Loading metrics...</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 900,
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>
                    <th style={{ padding: "12px 10px" }}>Service</th>
                    <th style={{ padding: "12px 10px" }}>Health</th>
                    <th style={{ padding: "12px 10px" }}>CPU</th>
                    <th style={{ padding: "12px 10px" }}>Memory</th>
                    <th style={{ padding: "12px 10px" }}>Latency</th>
                    <th style={{ padding: "12px 10px" }}>Error Rate</th>
                    <th style={{ padding: "12px 10px" }}>Uptime</th>
                    <th style={{ padding: "12px 10px" }}>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => (
                    <tr key={m.service} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "14px 10px", fontWeight: 600 }}>{m.service}</td>
                      <td style={{ padding: "14px 10px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 10px",
                            borderRadius: 999,
                            background: `${getHealthColor(m.healthLabel)}15`,
                            color: getHealthColor(m.healthLabel),
                            fontWeight: 700,
                            fontSize: 13,
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: getHealthColor(m.healthLabel),
                              display: "inline-block",
                            }}
                          />
                          {m.healthLabel} ({m.healthScore})
                        </span>
                      </td>
                      <td style={{ padding: "14px 10px" }}>{m.cpu.toFixed(1)}%</td>
                      <td style={{ padding: "14px 10px" }}>{m.memory.toFixed(1)}%</td>
                      <td style={{ padding: "14px 10px" }}>{m.latencyMs.toFixed(0)} ms</td>
                      <td style={{ padding: "14px 10px" }}>{m.errorRate.toFixed(2)}%</td>
                      <td style={{ padding: "14px 10px" }}>{m.uptimePct.toFixed(2)}%</td>
                      <td style={{ padding: "14px 10px", color: "#6b7280" }}>
                        {new Date(m.timestamp).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}