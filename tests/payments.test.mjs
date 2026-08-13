import assert from "node:assert/strict";
import test from "node:test";
import worker, { __test } from "../worker/index.js";

const ORIGIN = "https://app.example.test";
const SESSION_TOKEN = "test-session-token";
const CSRF_TOKEN = "test-csrf-token";
const DECISION_COMPARISON_ID = "comparison-a";
const assets = { fetch: async () => new Response("missing", { status: 404 }) };

class MemoryKV {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key) || null; }
  async put(key, value) { this.values.set(key, value); }
}

class PaymentD1 {
  constructor() {
    this.users = [];
    this.sessions = [];
    this.projects = [];
    this.orders = [];
    this.events = [];
    this.terminalRecords = [];
    this.reconciliationCases = [];
    this.reports = [];
    this.snapshots = [];
    this.decisionSnapshots = [];
    this.comparisons = [];
    this.selections = [];
    this.fulfillments = [];
    this.shares = [];
    this.maintenanceStatements = [];
  }

  prepare(sql) {
    const normalized = sql.replace(/\s+/gu, " ").trim();
    if (normalized.startsWith("DELETE FROM ai_generation_")
      || normalized.startsWith("DELETE FROM family_alignment_rooms")) this.maintenanceStatements.push(normalized);
    return new PaymentStatement(this, normalized);
  }

  async batch(statements) {
    const snapshot = structuredClone({
      orders: this.orders,
      events: this.events,
      terminalRecords: this.terminalRecords,
      reconciliationCases: this.reconciliationCases,
      snapshots: this.snapshots,
      decisionSnapshots: this.decisionSnapshots,
      fulfillments: this.fulfillments,
      projects: this.projects,
      shares: this.shares,
      selections: this.selections,
    });
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    } catch (error) {
      this.orders = snapshot.orders;
      this.events = snapshot.events;
      this.terminalRecords = snapshot.terminalRecords;
      this.reconciliationCases = snapshot.reconciliationCases;
      this.snapshots = snapshot.snapshots;
      this.decisionSnapshots = snapshot.decisionSnapshots;
      this.fulfillments = snapshot.fulfillments;
      this.projects = snapshot.projects;
      this.shares = snapshot.shares;
      this.selections = snapshot.selections;
      throw error;
    }
  }
}

class PaymentStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) { this.values = values; return this; }

  enrichedOrder(order) {
    if (!order) return null;
    const fulfillment = this.db.fulfillments.find((candidate) => candidate.order_id === order.id);
    const reportSnapshot = fulfillment && this.db.snapshots.find((candidate) => candidate.id === fulfillment.snapshot_id);
    const decisionSnapshot = this.db.decisionSnapshots.find((candidate) => candidate.order_id === order.id);
    return {
      ...order,
      fulfillment_id: fulfillment?.id || null,
      fulfillment_status: fulfillment?.status || null,
      fulfillment_status_reason: fulfillment?.status_reason || null,
      fulfillment_snapshot_id: fulfillment?.snapshot_id || null,
      fulfillment_created_at: fulfillment?.created_at || null,
      fulfillment_updated_at: fulfillment?.updated_at || null,
      fulfillment_ready_at: fulfillment?.ready_at || null,
      snapshot_schema_version: reportSnapshot?.snapshot_schema_version || null,
      snapshot_report_version: reportSnapshot?.report_version || null,
      snapshot_input_hash: reportSnapshot?.input_hash || null,
      snapshot_report_json: reportSnapshot?.report_json || null,
      snapshot_project_updated_at: reportSnapshot?.project_updated_at || null,
      snapshot_created_at: reportSnapshot?.created_at || null,
      decision_snapshot_id: decisionSnapshot?.id || null,
      decision_snapshot_version: decisionSnapshot?.snapshot_schema_version || null,
      decision_snapshot_created_at: decisionSnapshot?.created_at || null,
    };
  }

  async first() {
    if (this.sql.includes("FROM sessions s JOIN users u")) {
      const session = this.db.sessions.find((candidate) => candidate.token_hash === this.values[0]);
      const user = session && this.db.users.find((candidate) => candidate.id === session.user_id);
      return user ? {
        session_id: session.id,
        user_id: user.id,
        csrf_hash: session.csrf_hash,
        expires_at: session.expires_at,
        email: user.email,
        name: user.name,
        user_created_at: user.created_at,
      } : null;
    }
    if (this.sql.includes("FROM projects p WHERE p.id=? AND p.user_id=?")) {
      const project = this.db.projects.find((candidate) => candidate.id === this.values[0] && candidate.user_id === this.values[1]);
      return project ? { ...project, report_available: 0 } : null;
    }
    if (this.sql.includes("FROM decision_comparisons c") && this.sql.includes("JOIN decision_selections s")) {
      let comparison;
      if (this.sql.includes("WHERE c.id=?")) {
        comparison = this.db.comparisons.find((candidate) => candidate.id === this.values[0]
          && candidate.project_id === this.values[1] && candidate.user_id === this.values[2]);
      } else {
        comparison = this.db.comparisons
          .filter((candidate) => candidate.project_id === this.values[0] && candidate.user_id === this.values[1])
          .sort((left, right) => right.version - left.version)[0];
      }
      const selection = comparison && this.db.selections.find((candidate) => candidate.comparison_id === comparison.id);
      return comparison && selection ? { ...comparison, scenario_id: selection.scenario_id, selected_at: selection.selected_at, locked_at: selection.locked_at } : null;
    }
    if (this.sql.includes("o.idempotency_key=?")) {
      return this.enrichedOrder(this.db.orders.find((order) => order.user_id === this.values[0] && order.idempotency_key === this.values[1]));
    }
    if (this.sql.includes("COALESCE(o.product_code,o.plan)=?") && this.sql.includes("o.status IN ('created','paid')")) {
      const [userId, projectId, productCode] = this.values;
      const rows = this.db.orders.filter((order) => order.user_id === userId && order.project_id === projectId
        && (order.product_code || order.plan) === productCode && ["created", "paid"].includes(order.status));
      rows.sort((left, right) => Number(right.status === "paid") - Number(left.status === "paid") || right.created_at.localeCompare(left.created_at));
      return this.enrichedOrder(rows[0]);
    }
    if (this.sql.includes("FROM orders o") && this.sql.includes("WHERE o.id=? AND o.user_id=?")) {
      return this.enrichedOrder(this.db.orders.find((order) => order.id === this.values[0] && order.user_id === this.values[1]));
    }
    if (this.sql === "SELECT * FROM orders WHERE id=? AND user_id=?") {
      return this.db.orders.find((order) => order.id === this.values[0] && order.user_id === this.values[1]) || null;
    }
    if (this.sql === "SELECT * FROM orders WHERE id=?") {
      return this.db.orders.find((order) => order.id === this.values[0]) || null;
    }
    if (this.sql === "SELECT * FROM orders WHERE provider_order_id=?") {
      return this.db.orders.find((order) => order.provider_order_id === this.values[0]) || null;
    }
    if (this.sql === "SELECT * FROM orders WHERE provider_checkout_order_id=?") {
      return this.db.orders.find((order) => order.provider_checkout_order_id === this.values[0]) || null;
    }
    if (this.sql === "SELECT * FROM orders WHERE provider_payment_id=?") {
      return this.db.orders.find((order) => order.provider_payment_id === this.values[0]) || null;
    }
    if (this.sql.startsWith("SELECT provider_event_id,payload_sha256,processing_result FROM payment_webhook_events")) {
      return this.db.events.find((event) => event.provider_event_id === this.values[0]) || null;
    }
    if (this.sql.includes("FROM payment_terminal_records") && this.sql.includes("WHERE record_type=? AND provider_object_id=?")) {
      const [recordType, providerObjectId, terminalAction] = this.values;
      return this.db.terminalRecords.find((record) => record.record_type === recordType
        && record.provider_object_id === providerObjectId && record.terminal_action === terminalAction) || null;
    }
    if (this.sql.includes("FROM payment_terminal_records") && this.sql.includes("WHERE provider_payment_id=?")) {
      const [currency, providerPaymentId] = this.values;
      const records = this.db.terminalRecords.filter((record) => record.provider_payment_id === providerPaymentId);
      return {
        refunded_paise: records.filter((record) => record.record_type === "refund"
          && record.terminal_action === "refund_processed" && record.currency === currency)
          .reduce((total, record) => total + record.amount_paise, 0),
        has_dispute: records.some((record) => record.record_type === "dispute"
          && record.terminal_action === "entitlement_revoked") ? 1 : 0,
      };
    }
    if (this.sql === "SELECT * FROM reports WHERE project_id=? AND user_id=?") {
      return this.db.reports.find((report) => report.project_id === this.values[0] && report.user_id === this.values[1]) || null;
    }
    if (this.sql === "SELECT id FROM purchased_report_snapshots WHERE order_id=?") {
      const snapshot = this.db.snapshots.find((candidate) => candidate.order_id === this.values[0]);
      return snapshot ? { id: snapshot.id } : null;
    }
    if (this.sql === "SELECT id FROM purchased_decision_snapshots WHERE order_id=?") {
      const snapshot = this.db.decisionSnapshots.find((candidate) => candidate.order_id === this.values[0]);
      return snapshot ? { id: snapshot.id } : null;
    }
    if (this.sql === "SELECT * FROM purchased_decision_snapshots WHERE order_id=? AND user_id=?") {
      return this.db.decisionSnapshots.find((candidate) => candidate.order_id === this.values[0] && candidate.user_id === this.values[1]) || null;
    }
    if (this.sql.startsWith("SELECT id,status FROM orders WHERE user_id=?")) {
      const [userId, projectId, productCode, excludedId] = this.values;
      const orders = this.db.orders.filter((candidate) => candidate.user_id === userId && candidate.project_id === projectId
        && (candidate.product_code || candidate.plan) === productCode && candidate.id !== excludedId
        && ["created", "paid"].includes(candidate.status));
      orders.sort((left, right) => Number(right.status === "paid") - Number(left.status === "paid")
        || right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
      const order = orders[0];
      return order ? { id: order.id, status: order.status } : null;
    }
    throw new Error(`Unhandled PaymentD1 first(): ${this.sql}`);
  }

  async all() {
    if (this.sql.includes("FROM orders o") && this.sql.includes("o.project_id=?")) {
      const [userId, projectId, limit] = this.values;
      return { results: this.db.orders.filter((order) => order.user_id === userId && order.project_id === projectId).slice(0, limit).map((order) => this.enrichedOrder(order)) };
    }
    if (this.sql.includes("FROM orders o") && this.sql.includes("o.user_id=?")) {
      const [userId, limit] = this.values;
      return { results: this.db.orders.filter((order) => order.user_id === userId).slice(0, limit).map((order) => this.enrichedOrder(order)) };
    }
    throw new Error(`Unhandled PaymentD1 all(): ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("UPDATE decision_selections SET locked_at=?")) {
      const [lockedAt, comparisonId, projectId, userId, scenarioId] = this.values;
      const selection = this.db.selections.find((candidate) => candidate.comparison_id === comparisonId
        && candidate.project_id === projectId && candidate.user_id === userId
        && candidate.scenario_id === scenarioId && candidate.locked_at == null);
      const comparison = this.db.comparisons.find((candidate) => candidate.id === comparisonId);
      const project = this.db.projects.find((candidate) => candidate.id === projectId && candidate.user_id === userId);
      if (selection && Number(comparison?.project_input_revision || 1) === Number(project?.input_revision || 1)) {
        selection.locked_at = lockedAt;
      }
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO orders")) {
      const [
        id, project_id, user_id, plan, product_code, amount_paise, idempotency_key,
        request_hash, terms_version, terms_accepted_at, created_at, updated_at, provider_status,
      ] = this.values;
      if (this.db.orders.some((order) => order.idempotency_key === idempotency_key)) throw new Error("UNIQUE constraint failed");
      this.db.orders.push({
        id, project_id, user_id, plan, product_code, amount_paise, currency: "INR", idempotency_key, request_hash,
        status: "created", terms_version, terms_accepted_at, created_at, updated_at, provider_status,
        provider_order_id: null, provider_checkout_order_id: null, provider_payment_id: null,
        provider_error_code: null, checkout_url: null, paid_at: null,
        entitlement_revoked_at: null, entitlement_revocation_reason: null,
      });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE orders SET provider_order_id=?,provider_checkout_order_id=?")) {
      const [providerId, providerCheckoutOrderId, checkoutUrl, providerStatus, updatedAt, id, userId] = this.values;
      const order = this.db.orders.find((candidate) => candidate.id === id && candidate.user_id === userId && candidate.status === "created");
      if (order) Object.assign(order, { provider_order_id: providerId, provider_checkout_order_id: providerCheckoutOrderId, checkout_url: checkoutUrl, provider_status: providerStatus, provider_error_code: null, updated_at: updatedAt });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE orders SET status='failed',provider_status='expired'")) {
      for (const order of this.db.orders.filter((candidate) => candidate.status === "created")) {
        Object.assign(order, { status: "failed", provider_status: "expired", provider_error_code: "checkout_expired", checkout_url: null });
      }
      return { success: true };
    }
    if (this.sql.includes("provider_status='locally_cancelled_late_capture'")) {
      const [updatedAt, orderId] = this.values;
      const order = this.db.orders.find((candidate) => candidate.id === orderId && candidate.status === "created");
      if (order) Object.assign(order, {
        status: "failed", provider_status: "locally_cancelled_late_capture",
        provider_error_code: "superseded_by_late_capture", checkout_url: null, updated_at: updatedAt,
      });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE orders SET status='failed'")) {
      const [code, updatedAt, id, userId] = this.values;
      const order = this.db.orders.find((candidate) => candidate.id === id && candidate.user_id === userId && candidate.status === "created");
      if (order) Object.assign(order, { status: "failed", provider_status: "request_failed", provider_error_code: code, updated_at: updatedAt });
      return { success: true };
    }
    if (this.sql.startsWith("DELETE FROM sessions WHERE expires_at")) return { success: true };
    if (this.sql.startsWith("DELETE FROM ai_generation_leases WHERE expires_at")) return { success: true };
    if (this.sql.startsWith("DELETE FROM ai_generation_counters WHERE updated_at")) return { success: true };
    if (this.sql.startsWith("DELETE FROM decision_shares WHERE")) return { success: true };
    if (this.sql.startsWith("DELETE FROM family_alignment_rooms WHERE")) return { success: true };
    if (this.sql.startsWith("DELETE FROM product_event_aggregates WHERE")) return { success: true };
    if (this.sql.startsWith("INSERT INTO payment_webhook_events")) {
      const [provider_event_id, event_type, payload_sha256, order_id, provider_payment_id] = this.values;
      const dynamic = this.values.length > 8;
      const paidAction = dynamic ? this.values[5] === 1 : false;
      const order = dynamic ? this.db.orders.find((candidate) => candidate.id === this.values[6]) : null;
      const processing_result = dynamic
        ? order?.status === "refunded" && paidAction
          ? "paid_reconciled_refunded"
          : order?.status === "paid" && order.entitlement_revoked_at && paidAction
            ? "paid_reconciled_revoked"
            : this.values[9]
        : this.values[5];
      const received_at = dynamic ? this.values[10] : this.values[6];
      const processed_at = dynamic ? this.values[11] : this.values[7];
      if (this.db.events.some((event) => event.provider_event_id === provider_event_id)) throw new Error("UNIQUE constraint failed");
      this.db.events.push({ provider_event_id, event_type, payload_sha256, order_id, provider_payment_id, processing_result, received_at, processed_at });
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO payment_terminal_records")) {
      const [
        record_type, provider_object_id, terminal_action, provider_event_id, provider_payment_id,
        order_id, amount_paise, currency, provider_state, observed_at,
      ] = this.values;
      if (!this.db.terminalRecords.some((record) => record.record_type === record_type
        && record.provider_object_id === provider_object_id && record.terminal_action === terminal_action)) {
        this.db.terminalRecords.push({
          record_type, provider_object_id, terminal_action, provider_event_id, provider_payment_id,
          order_id, amount_paise, currency, provider_state, observed_at,
        });
      }
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO payment_reconciliation_cases")) {
      const [id, order_id, conflicting_order_id, provider_event_id, provider_payment_id, created_at, updated_at] = this.values;
      if (!this.db.reconciliationCases.some((entry) => entry.provider_payment_id === provider_payment_id)) {
        this.db.reconciliationCases.push({
          id, order_id, conflicting_order_id, provider_event_id, provider_payment_id,
          reason: "duplicate_late_capture", status: "open", created_at, updated_at, resolved_at: null,
        });
      }
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO purchased_report_snapshots")) {
      const [
        id, order_id, project_id, user_id, source_report_id, snapshot_schema_version,
        report_version, input_hash, project_name, input_json, estimate_json, report_json,
        project_updated_at, created_at,
      ] = this.values;
      if (this.db.snapshots.some((snapshot) => snapshot.order_id === order_id)) throw new Error("UNIQUE constraint failed");
      this.db.snapshots.push({
        id, order_id, project_id, user_id, source_report_id, snapshot_schema_version,
        report_version, input_hash, project_name, input_json, estimate_json, report_json,
        project_updated_at, created_at,
      });
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO purchased_decision_snapshots")) {
      const [id, order_id, project_id, user_id, comparison_id, selected_scenario_id, snapshot_schema_version, content_hash, artifact_json, created_at] = this.values;
      if (this.db.decisionSnapshots.some((snapshot) => snapshot.order_id === order_id)) throw new Error("UNIQUE constraint failed");
      const selection = this.db.selections.find((candidate) => candidate.comparison_id === comparison_id
        && candidate.project_id === project_id && candidate.user_id === user_id
        && candidate.scenario_id === selected_scenario_id && candidate.locked_at != null);
      const comparison = this.db.comparisons.find((candidate) => candidate.id === comparison_id);
      const project = this.db.projects.find((candidate) => candidate.id === project_id && candidate.user_id === user_id);
      if (!selection || Number(comparison?.project_input_revision || 1) !== Number(project?.input_revision || 1)) {
        throw new Error("purchase snapshot requires the locked decision selection");
      }
      this.db.decisionSnapshots.push({ id, order_id, project_id, user_id, comparison_id, selected_scenario_id, snapshot_schema_version, content_hash, artifact_json, created_at });
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO order_fulfillments")) {
      const [id, order_id, snapshot_id, project_id, user_id, plan, status, status_reason, created_at, updated_at, ready_at] = this.values;
      const targetOrder = this.db.orders.find((candidate) => candidate.id === this.values[11]
        && candidate.provider_payment_id === this.values[12] && candidate.status === "paid"
        && !candidate.entitlement_revoked_at);
      if (targetOrder && !this.db.fulfillments.some((fulfillment) => fulfillment.order_id === order_id)) {
        this.db.fulfillments.push({ id, order_id, snapshot_id, project_id, user_id, plan, status, status_reason, created_at, updated_at, ready_at });
      }
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE orders SET status='paid'")) {
      const [paymentId, linkId, providerCheckoutOrderId, providerStatus, paidAt, updatedAt, orderId] = this.values;
      const order = this.db.orders.find((candidate) => candidate.id === orderId && ["created", "failed"].includes(candidate.status));
      if (order) Object.assign(order, {
        status: "paid",
        provider_payment_id: paymentId,
        provider_order_id: order.provider_order_id || linkId,
        provider_checkout_order_id: order.provider_checkout_order_id || providerCheckoutOrderId,
        provider_status: providerStatus,
        provider_error_code: null,
        paid_at: order.paid_at || paidAt,
        updated_at: updatedAt,
      });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE orders SET status=CASE WHEN")) {
      const [revokedAt, updatedAt, paymentId] = this.values;
      const order = this.db.orders.find((candidate) => candidate.provider_payment_id === paymentId
        && ["paid", "failed"].includes(candidate.status));
      if (!order) return { success: true };
      const records = this.db.terminalRecords.filter((record) => record.provider_payment_id === paymentId);
      const refundedPaise = records.filter((record) => record.record_type === "refund"
        && record.terminal_action === "refund_processed" && record.currency === order.currency)
        .reduce((total, record) => total + record.amount_paise, 0);
      const fullRefund = refundedPaise >= order.amount_paise;
      const disputed = records.some((record) => record.record_type === "dispute"
        && record.terminal_action === "entitlement_revoked");
      if (fullRefund) {
        Object.assign(order, {
          status: "refunded", entitlement_revoked_at: order.entitlement_revoked_at || revokedAt,
          entitlement_revocation_reason: "refund_processed", provider_status: "refunded",
          checkout_url: null, updated_at: updatedAt,
        });
      } else if (disputed) {
        Object.assign(order, {
          entitlement_revoked_at: order.entitlement_revoked_at || revokedAt,
          entitlement_revocation_reason: order.entitlement_revocation_reason || "provider_dispute_preexisting",
          provider_status: "disputed", checkout_url: null, updated_at: updatedAt,
        });
      }
      return { success: true };
    }
    if (this.sql.includes("provider_status='captured_reconciliation_required'")) {
      const [paymentId, linkId, checkoutOrderId, paidAt, updatedAt, orderId] = this.values;
      const order = this.db.orders.find((candidate) => candidate.id === orderId && candidate.status === "failed");
      if (order) Object.assign(order, {
        provider_payment_id: paymentId,
        provider_order_id: order.provider_order_id || linkId,
        provider_checkout_order_id: order.provider_checkout_order_id || checkoutOrderId,
        provider_status: "captured_reconciliation_required",
        provider_error_code: "duplicate_late_capture",
        paid_at: order.paid_at || paidAt,
        checkout_url: null,
        updated_at: updatedAt,
      });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE orders SET status='refunded',provider_payment_id=?")) {
      const [paymentId, linkId, checkoutOrderId, paidAt, revokedAt, updatedAt, orderId] = this.values;
      const order = this.db.orders.find((candidate) => candidate.id === orderId && ["created", "failed"].includes(candidate.status));
      const refundedPaise = this.db.terminalRecords.filter((record) => record.provider_payment_id === paymentId
        && record.record_type === "refund" && record.terminal_action === "refund_processed" && record.currency === order?.currency)
        .reduce((total, record) => total + record.amount_paise, 0);
      if (order && refundedPaise >= order.amount_paise) Object.assign(order, {
        status: "refunded", provider_payment_id: paymentId,
        provider_order_id: order.provider_order_id || linkId,
        provider_checkout_order_id: order.provider_checkout_order_id || checkoutOrderId,
        provider_status: "refunded", provider_error_code: null, paid_at: order.paid_at || paidAt,
        entitlement_revoked_at: order.entitlement_revoked_at || revokedAt,
        entitlement_revocation_reason: "refund_processed", checkout_url: null, updated_at: updatedAt,
      });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE orders SET status='refunded'")) {
      const [revokedAt, providerStatus, updatedAt, orderId, paymentId] = this.values;
      const order = this.db.orders.find((candidate) => candidate.id === orderId
        && ["paid", "failed"].includes(candidate.status) && candidate.provider_payment_id === paymentId);
      const refundedPaise = this.db.terminalRecords.filter((record) => record.provider_payment_id === paymentId
        && record.record_type === "refund" && record.terminal_action === "refund_processed" && record.currency === order?.currency)
        .reduce((total, record) => total + record.amount_paise, 0);
      if (order && refundedPaise >= order.amount_paise) Object.assign(order, {
        status: "refunded",
        entitlement_revoked_at: order.entitlement_revoked_at || revokedAt,
        entitlement_revocation_reason: "refund_processed",
        provider_status: providerStatus,
        checkout_url: null,
        updated_at: updatedAt,
      });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE payment_reconciliation_cases")) {
      const [resolvedAt, updatedAt, paymentId] = this.values;
      const order = this.db.orders.find((candidate) => candidate.provider_payment_id === paymentId);
      for (const entry of this.db.reconciliationCases.filter((candidate) => candidate.provider_payment_id === paymentId
        && candidate.status === "open" && order?.status === "refunded")) {
        Object.assign(entry, { status: "resolved_refunded", resolved_at: entry.resolved_at || resolvedAt, updated_at: updatedAt });
      }
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE orders SET entitlement_revoked_at=")) {
      const [revokedAt, reason, providerStatus, updatedAt, orderId, paymentId] = this.values;
      const order = this.db.orders.find((candidate) => candidate.id === orderId && candidate.status === "paid" && candidate.provider_payment_id === paymentId);
      if (order) Object.assign(order, {
        entitlement_revoked_at: order.entitlement_revoked_at || revokedAt,
        entitlement_revocation_reason: reason,
        provider_status: providerStatus,
        checkout_url: null,
        updated_at: updatedAt,
      });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE projects SET status='expert_review'")) {
      const [updatedAt, projectId, userId] = this.values;
      const project = this.db.projects.find((candidate) => candidate.id === projectId && candidate.user_id === userId && candidate.status !== "archived");
      if (project) Object.assign(project, { status: "expert_review", updated_at: updatedAt });
      return { success: true };
    }
    throw new Error(`Unhandled PaymentD1 run(): ${this.sql}`);
  }
}

async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fixture() {
  const DB = new PaymentD1();
  const tokenHash = await __test.digestBase64(SESSION_TOKEN);
  const csrfHash = await __test.digestBase64(CSRF_TOKEN);
  DB.users.push({ id: "user-a", email: "owner@example.test", name: "Owner", created_at: "2026-08-13 00:00:00" });
  DB.users.push({ id: "user-b", email: "other@example.test", name: "Other", created_at: "2026-08-13 00:00:00" });
  DB.sessions.push({ id: "session-a", user_id: "user-a", token_hash: tokenHash, csrf_hash: csrfHash, expires_at: "2099-01-01 00:00:00" });
  const input = { width: 30, length: 50, floors: 2, bedrooms: 3, quality: "Standard", city: "Bengaluru" };
  const estimate = __test.computeEstimate(input);
  const project = { id: "project-a", user_id: "user-a", name: "A", status: "draft", input_json: JSON.stringify(input), estimate_json: JSON.stringify(estimate), input_revision: 1, created_at: "2026-08-13 00:00:00", updated_at: "2026-08-13 00:00:00" };
  DB.projects.push(project);
  DB.projects.push({ ...project, id: "project-c", name: "C" });
  DB.projects.push({ ...project, id: "project-b", user_id: "user-b", name: "B" });

  const normalized = __test.normalizeDecisionInput({
    priority: "balanced",
    scenarios: [
      { label: "Compact courtyard", floors: "G+1", bedrooms: 3, parking: true, quality: "Signature", notes: "Protect the garden." },
      { label: "Vertical family", floors: "G+2", bedrooms: 5, parking: true, quality: "Premium", notes: "Make room for parents." },
    ],
  });
  const sourceInputHash = await sha256Hex(__test.stableStringify({ input, estimate }));
  const content = __test.buildDecisionContent(project, normalized.priority, normalized.scenarios, DECISION_COMPARISON_ID, sourceInputHash);
  const contentHash = await sha256Hex(JSON.stringify(content));
  DB.comparisons.push({
    id: DECISION_COMPARISON_ID,
    project_id: project.id,
    user_id: project.user_id,
    version: 1,
    priority: normalized.priority,
    content_hash: contentHash,
    content_json: JSON.stringify(content),
    project_input_revision: 1,
    created_at: "2026-08-13 00:01:00",
  });
  DB.selections.push({
    comparison_id: DECISION_COMPARISON_ID,
    project_id: project.id,
    user_id: project.user_id,
    scenario_id: content.scenarios[0].id,
    selected_at: "2026-08-13 00:02:00",
    locked_at: null,
  });

  const providerCalls = [];
  const env = {
    ASSETS: assets,
    DB,
    GRIHAGRID_CACHE: new MemoryKV(),
    APP_ENV: "test",
    APP_ORIGIN: ORIGIN,
    PAID_CHECKOUT_ENABLED: "true",
    DECISION_COMPARE_FULFILLMENT_ENABLED: "true",
    ENABLED_PAYMENT_PLANS: "decision_compare",
    RAZORPAY_KEY_ID: "rzp_test_key",
    RAZORPAY_KEY_SECRET: "test-secret",
    RAZORPAY_WEBHOOK_SECRET: "webhook-secret",
    FILES: {},
    RAZORPAY_FETCH: async (url, init) => {
      providerCalls.push({ url, init, body: JSON.parse(init.body) });
      const number = providerCalls.length;
      return Response.json({ id: `plink_TEST${number}`, order_id: `order_TEST${number}`, short_url: `https://rzp.io/i/test${number}`, status: "created" }, { status: 200 });
    },
  };
  return { DB, env, providerCalls, decisionComparisonId: DECISION_COMPARISON_ID, selectedScenarioId: content.scenarios[0].id };
}

function authHeaders(extra = {}) {
  return {
    origin: ORIGIN,
    cookie: `__Host-grihagrid_session=${SESSION_TOKEN}; grihagrid_csrf=${CSRF_TOKEN}`,
    "x-csrf-token": CSRF_TOKEN,
    "content-type": "application/json",
    ...extra,
  };
}

function appRequest(path, init = {}) { return new Request(`${ORIGIN}${path}`, init); }

function decisionCheckoutBody(decisionComparisonId = DECISION_COMPARISON_ID, extra = {}) {
  return {
    plan: "decision_compare",
    decisionComparisonId,
    acceptedTerms: true,
    acceptedProfessionalBoundary: true,
    termsVersion: "pilot-v1",
    ...extra,
  };
}

function seededOrder(overrides = {}) {
  return {
    id: "seeded-order",
    project_id: "project-a",
    user_id: "user-a",
    plan: "plan",
    product_code: "plan",
    amount_paise: 49_900,
    currency: "INR",
    idempotency_key: "seeded-key",
    status: "created",
    provider_order_id: "plink_SEEDED",
    provider_checkout_order_id: "order_SEEDED",
    provider_payment_id: null,
    checkout_url: "https://rzp.io/i/seeded",
    provider_status: "created",
    provider_error_code: null,
    paid_at: null,
    entitlement_revoked_at: null,
    entitlement_revocation_reason: null,
    terms_version: null,
    terms_accepted_at: null,
    created_at: "2026-08-13 00:00:00",
    updated_at: "2026-08-13 00:00:00",
    ...overrides,
  };
}

function seedLegacySnapshot(DB, orderId, overrides = {}) {
  const snapshot = {
    id: `${orderId}-snapshot`,
    order_id: orderId,
    project_id: "project-a",
    user_id: "user-a",
    source_report_id: null,
    snapshot_schema_version: 1,
    report_version: 1,
    input_hash: "f".repeat(64),
    project_name: "A",
    input_json: "{}",
    estimate_json: "{}",
    report_json: JSON.stringify({ title: "A — feasibility report" }),
    project_updated_at: "2026-08-13 00:00:00",
    created_at: "2026-08-13 00:00:00",
    ...overrides,
  };
  DB.snapshots.push(snapshot);
  return snapshot;
}

async function signedWebhook(env, eventId, payload) {
  const raw = JSON.stringify(payload);
  const signature = await __test.hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, new TextEncoder().encode(raw));
  return worker.fetch(appRequest("/api/payments/razorpay/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": signature, "x-razorpay-event-id": eventId },
    body: raw,
  }), env);
}

test("checkout prices are server-owned and only Decision Compare is newly sellable", () => {
  assert.equal(__test.paymentPlan("decision_compare").amountPaise, 99_900);
  assert.equal(__test.paymentPlan("decision_compare").productCode, "decision_compare");
  assert.equal(__test.paymentPlan("plan").amountPaise, 49_900);
  assert.equal(__test.paymentPlan("site_plus").amountPaise, 99_900);
  assert.equal(__test.paymentPlan("expert").amountPaise, 349_900);
  assert.throws(() => __test.paymentPlan("admin-free"), /plan must be one of/u);
});

test("public commerce catalog exposes one server-priced SKU and fails closed", async () => {
  const { env } = await fixture();
  const open = await worker.fetch(appRequest("/api/commerce/catalog"), env);
  assert.equal(open.status, 200);
  assert.equal(open.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual((await open.json()).plans, [{
    id: "decision_compare",
    label: "Decision Compare",
    amountPaise: 99_900,
    currency: "INR",
    taxInclusive: true,
    displayPrice: "₹999",
    termsVersion: "pilot-v1",
    acceptingOrders: true,
  }]);

  for (const closedEnv of [
    { ...env, PAID_CHECKOUT_ENABLED: "false" },
    { ...env, DECISION_COMPARE_FULFILLMENT_ENABLED: "false" },
    { ...env, ENABLED_PAYMENT_PLANS: "" },
    { ...env, ENABLED_PAYMENT_PLANS: "decision_compare,plan" },
    { ...env, RAZORPAY_WEBHOOK_SECRET: "" },
  ]) {
    const body = await (await worker.fetch(appRequest("/api/commerce/catalog"), closedEnv)).json();
    assert.equal(body.plans.length, 1);
    assert.equal(body.plans[0].acceptingOrders, false);
  }
});

test("Razorpay signatures are checked against the exact raw bytes", async () => {
  const bytes = new TextEncoder().encode('{"event":"payment.captured","amount":99900}');
  const signature = await __test.hmacSha256Hex("webhook-secret", bytes);
  assert.equal(await __test.verifyRazorpaySignature("webhook-secret", bytes, signature), true);
  assert.equal(await __test.verifyRazorpaySignature("wrong-secret", bytes, signature), false);
  assert.equal(await __test.verifyRazorpaySignature("webhook-secret", new TextEncoder().encode("{}"), signature), false);
});

test("Decision Compare checkout rejects client pricing, missing consent, and retired SKUs", async () => {
  const { env, DB, decisionComparisonId } = await fixture();
  const request = async (key, body) => worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": key }),
    body: JSON.stringify(body),
  }), env);

  const clientPrice = await request("invalid-price-0001", decisionCheckoutBody(decisionComparisonId, { amountPaise: 1 }));
  assert.equal(clientPrice.status, 400);
  assert.equal((await clientPrice.json()).code, "invalid_checkout");

  const noTerms = await request("missing-terms-0001", { ...decisionCheckoutBody(decisionComparisonId), acceptedTerms: false });
  assert.equal(noTerms.status, 400);
  assert.equal((await noTerms.json()).code, "checkout_terms_required");

  const staleTerms = await request("stale-terms-0001", { ...decisionCheckoutBody(decisionComparisonId), termsVersion: "pilot-v0" });
  assert.equal(staleTerms.status, 409);
  assert.equal((await staleTerms.json()).code, "checkout_terms_updated");

  const { decisionComparisonId: _omitted, ...missingComparisonBody } = decisionCheckoutBody(decisionComparisonId);
  const missingComparison = await request("missing-comparison-0001", missingComparisonBody);
  assert.equal(missingComparison.status, 400);
  assert.equal((await missingComparison.json()).code, "decision_comparison_required");

  for (const plan of ["plan", "site_plus", "expert"]) {
    const retired = await request(`retired-${plan}-0001`, { plan });
    assert.equal(retired.status, 503);
    assert.equal((await retired.json()).code, "payment_plan_unavailable");
  }
  assert.equal(DB.orders.length, 0);
});

test("checkout creates one ₹999 provider link and replays idempotently", async () => {
  const { env, DB, providerCalls, decisionComparisonId, selectedScenarioId } = await fixture();
  const create = (key = "checkout-attempt-0001", projectId = "project-a") => worker.fetch(appRequest(`/api/projects/${projectId}/orders`, {
    method: "POST",
    headers: authHeaders({ "idempotency-key": key }),
    body: JSON.stringify(decisionCheckoutBody(decisionComparisonId)),
  }), env);

  const first = await create();
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.order.plan, "decision_compare");
  assert.equal(firstBody.order.amountPaise, 99_900);
  assert.equal(firstBody.order.taxInclusive, true);
  assert.equal(firstBody.checkoutUrl, "https://rzp.io/i/test1");
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].url, "https://api.razorpay.com/v1/payment_links/");
  assert.equal(providerCalls[0].body.amount, 99_900);
  assert.equal(providerCalls[0].body.currency, "INR");
  assert.equal(providerCalls[0].body.accept_partial, false);
  assert.equal(providerCalls[0].body.customer.email, "owner@example.test");
  assert.equal(providerCalls[0].body.notes.grihagrid_plan, "decision_compare");
  assert.match(providerCalls[0].body.description, /inclusive of applicable taxes/u);
  assert.match(providerCalls[0].body.callback_url, /^https:\/\/app\.example\.test\/checkout\/return\?order=/u);
  assert.equal(DB.orders[0].plan, "plan");
  assert.equal(DB.orders[0].product_code, "decision_compare");
  assert.equal(DB.orders[0].terms_version, "pilot-v1");
  assert.ok(DB.orders[0].terms_accepted_at);
  assert.equal(DB.decisionSnapshots.length, 1);
  assert.equal(DB.decisionSnapshots[0].comparison_id, decisionComparisonId);
  assert.equal(DB.decisionSnapshots[0].selected_scenario_id, selectedScenarioId);

  const replay = await create();
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).idempotentReplay, true);
  assert.equal(providerCalls.length, 1);

  const differentKey = await create("checkout-attempt-0002");
  assert.equal(differentKey.status, 200);
  assert.equal((await differentKey.json()).reusedExisting, true);
  assert.equal(providerCalls.length, 1);

  const conflict = await create("checkout-attempt-0001", "project-c");
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "idempotency_conflict");
});

test("checkout reuse is pinned to the explicit comparison and canonical consent request", async () => {
  const { env, DB, providerCalls, decisionComparisonId } = await fixture();
  const create = (key, comparisonId) => worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": key }),
    body: JSON.stringify(decisionCheckoutBody(comparisonId)),
  }), env);

  const first = await create("request-hash-version-0001", decisionComparisonId);
  assert.equal(first.status, 201);
  assert.match(DB.orders[0].request_hash, /^[0-9a-f]{64}$/u);

  const sameKeyDifferentVersion = await create("request-hash-version-0001", "comparison-new-version");
  assert.equal(sameKeyDifferentVersion.status, 409);
  assert.equal((await sameKeyDifferentVersion.json()).code, "idempotency_conflict");

  const newKeyDifferentVersion = await create("request-hash-version-0002", "comparison-new-version");
  assert.equal(newKeyDifferentVersion.status, 409);
  assert.equal((await newKeyDifferentVersion.json()).code, "active_checkout_conflict");
  assert.equal(DB.orders.length, 1);
  assert.equal(providerCalls.length, 1);
});

test("provider timeout fails the local order without creating a payable result", async () => {
  const { env, DB, decisionComparisonId } = await fixture();
  env.RAZORPAY_FETCH = async (_url, init) => {
    assert.equal(init.signal instanceof AbortSignal, true);
    throw new DOMException("timed out", "TimeoutError");
  };
  const response = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "provider-timeout-0001" }),
    body: JSON.stringify(decisionCheckoutBody(decisionComparisonId)),
  }), env);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "payment_provider_error");
  assert.equal(DB.orders.length, 1);
  assert.equal(DB.orders[0].status, "failed");
  assert.equal(DB.orders[0].provider_error_code, "network_error");
  assert.equal(DB.orders[0].checkout_url, null);
  assert.equal(DB.decisionSnapshots.length, 1);
});

test("daily maintenance expires stale checkout links and covers new retention tables", async () => {
  const { DB } = await fixture();
  DB.orders.push(seededOrder({
    id: "stale",
    product_code: "decision_compare",
    amount_paise: 99_900,
    idempotency_key: "stale-key",
    checkout_url: "https://rzp.io/i/stale",
    created_at: "2020-01-01 00:00:00",
    updated_at: "2020-01-01 00:00:00",
  }));
  let maintenance;
  await worker.scheduled({}, { DB }, { waitUntil(promise) { maintenance = promise; } });
  await maintenance;
  assert.equal(DB.orders[0].status, "failed");
  assert.equal(DB.orders[0].provider_status, "expired");
  assert.equal(DB.orders[0].provider_error_code, "checkout_expired");
  assert.equal(DB.orders[0].checkout_url, null);
  assert.equal(DB.maintenanceStatements.some((sql) => sql.startsWith("DELETE FROM ai_generation_leases")), true);
  assert.equal(DB.maintenanceStatements.some((sql) => sql.startsWith("DELETE FROM ai_generation_counters")), true);
  assert.equal(DB.maintenanceStatements.some((sql) => sql.startsWith("DELETE FROM family_alignment_rooms")), true);
});

test("a late capture atomically supersedes an unpaid replacement checkout", async () => {
  const { env, DB } = await fixture();
  DB.orders.push(
    seededOrder({ id: "expired-order", idempotency_key: "expired-key", status: "failed", provider_order_id: "plink_EXPIRED", provider_checkout_order_id: "order_EXPIRED", checkout_url: null, provider_status: "expired", provider_error_code: "checkout_expired" }),
    seededOrder({ id: "replacement-order", idempotency_key: "replacement-key", provider_order_id: "plink_REPLACEMENT", provider_checkout_order_id: "order_REPLACEMENT", checkout_url: "https://rzp.io/i/replacement" }),
  );
  seedLegacySnapshot(DB, "expired-order");
  const response = await signedWebhook(env, "evt_late_capture", {
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_LATE", order_id: "order_EXPIRED", status: "captured", captured: true, amount: 49_900, currency: "INR",
    } } },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result, "late_payment_recovered");
  assert.equal(DB.orders[0].status, "paid");
  assert.equal(DB.orders[0].provider_payment_id, "pay_LATE");
  assert.equal(DB.orders[1].status, "failed");
  assert.equal(DB.orders[1].provider_error_code, "superseded_by_late_capture");
  assert.equal(DB.orders[1].checkout_url, null);
  assert.equal(DB.fulfillments.length, 1);
  assert.equal(DB.events[0].processing_result, "late_payment_recovered");
});

test("a late capture after a sibling was paid opens a finance case and grants no second entitlement", async () => {
  const { env, DB } = await fixture();
  DB.orders.push(
    seededOrder({
      id: "late-captured-order",
      idempotency_key: "late-captured-key",
      status: "failed",
      provider_order_id: "plink_LATEPAID",
      provider_checkout_order_id: "order_LATEPAID",
      checkout_url: null,
      provider_status: "expired",
      provider_error_code: "checkout_expired",
    }),
    seededOrder({
      id: "already-paid-replacement",
      idempotency_key: "already-paid-key",
      status: "paid",
      provider_order_id: "plink_ALREADYPAID",
      provider_checkout_order_id: "order_ALREADYPAID",
      provider_payment_id: "pay_ALREADYPAID",
      checkout_url: null,
      provider_status: "captured",
      paid_at: "2026-08-13 00:05:00",
    }),
  );

  const response = await signedWebhook(env, "evt_duplicate_late_capture", {
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_SECONDCHARGE", order_id: "order_LATEPAID", status: "captured", captured: true,
      amount: 49_900, currency: "INR",
    } } },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result, "late_payment_requires_reconciliation");
  assert.equal(DB.orders[0].status, "failed");
  assert.equal(DB.orders[0].provider_payment_id, "pay_SECONDCHARGE");
  assert.equal(DB.orders[0].provider_status, "captured_reconciliation_required");
  assert.equal(DB.orders[1].status, "paid");
  assert.equal(DB.reconciliationCases.length, 1);
  assert.equal(DB.reconciliationCases[0].status, "open");
  assert.equal(DB.reconciliationCases[0].conflicting_order_id, "already-paid-replacement");
  assert.equal(DB.fulfillments.length, 0);

  const ownerRead = await worker.fetch(appRequest("/api/orders/late-captured-order", { headers: authHeaders() }), env);
  const ownerOrder = (await ownerRead.json()).order;
  assert.equal(ownerOrder.status, "failed");
  assert.equal(ownerOrder.paymentIssue.requiresAction, true);
  assert.equal(ownerOrder.paymentIssue.code, "duplicate_late_capture");

  const refunded = await signedWebhook(env, "evt_duplicate_late_refund", {
    event: "refund.processed",
    payload: { refund: { entity: {
      id: "rfnd_SECONDCHARGE", payment_id: "pay_SECONDCHARGE", amount: 49_900, currency: "INR", status: "processed",
    } } },
  });
  assert.equal((await refunded.json()).result, "refunded");
  assert.equal(DB.orders[0].status, "refunded");
  assert.equal(DB.reconciliationCases[0].status, "resolved_refunded");
  assert.ok(DB.reconciliationCases[0].resolved_at);
});

test("checkout is owner-scoped and every launch dependency fails closed", async () => {
  const { env, DB, providerCalls, decisionComparisonId } = await fixture();
  const checkout = (targetEnv, key = "checkout-scope-0001", projectId = "project-a") => worker.fetch(appRequest(`/api/projects/${projectId}/orders`, {
    method: "POST",
    headers: authHeaders({ "idempotency-key": key }),
    body: JSON.stringify(decisionCheckoutBody(decisionComparisonId)),
  }), targetEnv);

  const forbidden = await checkout(env, "ownership-attempt-0001", "project-b");
  assert.equal(forbidden.status, 404);
  assert.equal((await forbidden.json()).code, "project_not_found");

  const paidOff = await checkout({ ...env, PAID_CHECKOUT_ENABLED: "false" }, "paid-off-0001");
  assert.equal(paidOff.status, 503);
  assert.equal((await paidOff.json()).code, "payments_disabled");

  const fulfillmentOff = await checkout({ ...env, DECISION_COMPARE_FULFILLMENT_ENABLED: "false" }, "fulfillment-off-0001");
  assert.equal(fulfillmentOff.status, 503);
  assert.equal((await fulfillmentOff.json()).code, "fulfillment_paused");

  const planOff = await checkout({ ...env, ENABLED_PAYMENT_PLANS: "" }, "plan-off-0001");
  assert.equal(planOff.status, 503);
  assert.equal((await planOff.json()).code, "payment_plan_unavailable");

  const missingProvider = await checkout({ ...env, RAZORPAY_KEY_SECRET: "" }, "missing-config-0001");
  assert.equal(missingProvider.status, 503);
  assert.equal((await missingProvider.json()).code, "payments_unavailable");

  const missingWebhook = await checkout({ ...env, RAZORPAY_WEBHOOK_SECRET: "" }, "missing-webhook-0001");
  assert.equal(missingWebhook.status, 503);
  assert.equal((await missingWebhook.json()).code, "payments_unavailable");

  const noCsrf = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "x-csrf-token": "", "idempotency-key": "missing-csrf-0001" }),
    body: JSON.stringify(decisionCheckoutBody(decisionComparisonId)),
  }), env);
  assert.equal(noCsrf.status, 403);
  assert.equal((await noCsrf.json()).code, "csrf_rejected");
  assert.equal(DB.orders.length, 0);
  assert.equal(providerCalls.length, 0);

  const noR2 = await checkout({ ...env, FILES: undefined }, "no-r2-needed-0001");
  assert.equal(noR2.status, 201);
  assert.equal(providerCalls.length, 1);
});

test("signed payment atomically activates the immutable Decision Compare artifact once", async () => {
  const { env, DB, decisionComparisonId, selectedScenarioId } = await fixture();
  const created = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "decision-paid-0001" }),
    body: JSON.stringify(decisionCheckoutBody(decisionComparisonId)),
  }), env);
  assert.equal(created.status, 201);
  const order = (await created.json()).order;
  const frozenArtifact = DB.decisionSnapshots[0].artifact_json;
  DB.projects[0].name = "Changed after checkout";

  const payload = {
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: "plink_TEST1", order_id: "order_TEST1", reference_id: order.id, status: "paid", amount_paid: 99_900, currency: "INR" } },
      payment: { entity: { id: "pay_DECISION1", order_id: "order_TEST1", status: "captured", captured: true, amount: 99_900, currency: "INR" } },
    },
  };
  const first = await signedWebhook(env, "evt_decision_paid_0001", payload);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { received: true, duplicate: false, result: "paid" });
  assert.equal(DB.orders[0].status, "paid");
  assert.equal(DB.orders[0].provider_payment_id, "pay_DECISION1");
  assert.equal(DB.events.length, 1);
  assert.equal(DB.decisionSnapshots.length, 1);
  assert.equal(DB.decisionSnapshots[0].artifact_json, frozenArtifact);
  assert.equal(DB.fulfillments.length, 0);

  const artifactResponse = await worker.fetch(appRequest(`/api/orders/${order.id}/artifact`, { headers: authHeaders() }), env);
  assert.equal(artifactResponse.status, 200);
  const artifactBody = await artifactResponse.json();
  assert.equal(artifactBody.order.status, "paid");
  assert.equal(artifactBody.order.entitlement.active, true);
  assert.equal(artifactBody.order.fulfillment.status, "ready");
  assert.equal(artifactBody.artifact.type, "purchased_decision_compare");
  assert.equal(artifactBody.artifact.comparison.projectName, "A");
  assert.equal(artifactBody.artifact.selectedScenarioId, selectedScenarioId);

  const duplicate = await signedWebhook(env, "evt_decision_paid_0001", payload);
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(DB.events.length, 1);
  assert.equal(DB.decisionSnapshots.length, 1);
});

test("historical Expert Review capture remains webhook-compatible but is not newly sellable", async () => {
  const { env, DB } = await fixture();
  DB.orders.push(seededOrder({
    id: "legacy-expert",
    plan: "expert",
    product_code: "expert",
    amount_paise: 349_900,
    idempotency_key: "legacy-expert-key",
    provider_order_id: "plink_EXPERT",
    provider_checkout_order_id: "order_EXPERT",
  }));
  seedLegacySnapshot(DB, "legacy-expert");

  const response = await signedWebhook(env, "evt_legacy_expert", {
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_EXPERT", order_id: "order_EXPERT", status: "captured", captured: true,
      amount: 349_900, currency: "INR", notes: [],
    } } },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result, "paid");
  assert.equal(DB.orders[0].status, "paid");
  assert.equal(DB.fulfillments[0].status, "queued");
  assert.equal(DB.fulfillments[0].status_reason, "expert_review_queue");
  assert.equal(DB.projects[0].status, "expert_review");
});

test("historical Plan Pack payment still exposes its immutable owner-scoped report", async () => {
  const { env, DB } = await fixture();
  DB.orders.push(seededOrder({ id: "legacy-plan", idempotency_key: "legacy-plan-key", provider_order_id: "plink_PLAN", provider_checkout_order_id: "order_PLAN" }));
  const snapshot = seedLegacySnapshot(DB, "legacy-plan");
  const paid = await signedWebhook(env, "evt_legacy_plan", {
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: "plink_PLAN", order_id: "order_PLAN", reference_id: "legacy-plan", status: "paid", amount_paid: 49_900, currency: "INR" } },
      payment: { entity: { id: "pay_PLAN", order_id: "order_PLAN", status: "captured", captured: true, amount: 49_900, currency: "INR" } },
    },
  });
  assert.equal(paid.status, 200);
  assert.equal(DB.fulfillments.length, 1);
  assert.equal(DB.fulfillments[0].snapshot_id, snapshot.id);

  const read = await worker.fetch(appRequest("/api/orders/legacy-plan/fulfillment", { headers: authHeaders() }), env);
  assert.equal(read.status, 200);
  const body = await read.json();
  assert.equal(body.order.plan, "plan");
  assert.equal(body.fulfillment.status, "ready");
  assert.equal(body.artifact.type, "purchased_report_snapshot");
  assert.equal(body.artifact.report.title, "A — feasibility report");
});

test("a verified Decision Compare payment is not acknowledged without its snapshot", async () => {
  const { env, DB, decisionComparisonId } = await fixture();
  const created = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "missing-snapshot-0001" }),
    body: JSON.stringify(decisionCheckoutBody(decisionComparisonId)),
  }), env);
  const order = (await created.json()).order;
  DB.decisionSnapshots = [];
  const response = await signedWebhook(env, "evt_missing_snapshot", {
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_NOSNAPSHOT", order_id: "order_TEST1", status: "captured", captured: true, amount: 99_900, currency: "INR",
    } } },
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, "purchase_snapshot_missing");
  assert.equal(DB.orders[0].status, "created");
  assert.equal(DB.events.length, 0);
  assert.equal(DB.fulfillments.length, 0);
  assert.equal(order.status, "created");
});

test("webhook rejects bad signatures and never pays amount or currency mismatches", async () => {
  const { env, DB } = await fixture();
  DB.orders.push(seededOrder({
    id: "order-safe",
    product_code: "decision_compare",
    amount_paise: 99_900,
    idempotency_key: "scoped",
    provider_order_id: "plink_SAFE",
    provider_checkout_order_id: "order_SAFE",
  }));
  const payload = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_WRONG", order_id: "order_SAFE", status: "captured", captured: true, amount: 1, currency: "INR",
    } } },
  });
  const invalid = await worker.fetch(appRequest("/api/payments/razorpay/webhook", {
    method: "POST",
    headers: { "x-razorpay-signature": "0".repeat(64), "x-razorpay-event-id": "evt_bad_sig" },
    body: payload,
  }), env);
  assert.equal(invalid.status, 401);
  assert.equal(DB.events.length, 0);

  const signature = await __test.hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, new TextEncoder().encode(payload));
  const mismatch = await worker.fetch(appRequest("/api/payments/razorpay/webhook", {
    method: "POST",
    headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_amount_mismatch" },
    body: payload,
  }), env);
  assert.equal(mismatch.status, 200);
  assert.equal((await mismatch.json()).result, "amount_mismatch");
  assert.equal(DB.orders[0].status, "created");
});

test("a processed refund received before capture prevents entitlement activation", async () => {
  const { env, DB, decisionComparisonId } = await fixture();
  const created = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "refund-before-paid-0001" }),
    body: JSON.stringify(decisionCheckoutBody(decisionComparisonId)),
  }), env);
  const order = (await created.json()).order;

  const earlyRefund = await signedWebhook(env, "evt_refund_before_paid", {
    event: "refund.processed",
    payload: { refund: { entity: {
      id: "rfnd_BEFOREPAID", payment_id: "pay_BEFOREPAID", amount: 99_900, currency: "INR", status: "processed",
    } } },
  });
  assert.equal(earlyRefund.status, 200);
  assert.equal((await earlyRefund.json()).result, "refund_pending_payment");
  assert.equal(DB.orders[0].status, "created");
  assert.equal(DB.terminalRecords.length, 1);
  assert.equal(DB.terminalRecords[0].order_id, null);

  const capture = await signedWebhook(env, "evt_capture_after_refund", {
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_BEFOREPAID", order_id: "order_TEST1", status: "captured", captured: true,
      amount: 99_900, currency: "INR",
    } } },
  });
  assert.equal(capture.status, 200);
  assert.equal((await capture.json()).result, "paid_reconciled_refunded");
  assert.equal(DB.orders[0].status, "refunded");
  assert.equal(DB.orders[0].provider_payment_id, "pay_BEFOREPAID");
  assert.equal(DB.orders[0].entitlement_revocation_reason, "refund_processed");

  const artifact = await worker.fetch(appRequest(`/api/orders/${order.id}/artifact`, { headers: authHeaders() }), env);
  assert.equal(artifact.status, 410);
});

test("a dispute received before capture makes the eventual paid order non-entitled", async () => {
  const { env, DB, decisionComparisonId } = await fixture();
  const created = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "dispute-before-paid-0001" }),
    body: JSON.stringify(decisionCheckoutBody(decisionComparisonId)),
  }), env);
  const order = (await created.json()).order;

  const earlyDispute = await signedWebhook(env, "evt_dispute_before_paid", {
    event: "payment.dispute.created",
    payload: { dispute: { entity: {
      id: "disp_BEFOREPAID", payment_id: "pay_DISPUTEBEFORE", status: "open",
    } } },
  });
  assert.equal(earlyDispute.status, 200);
  assert.equal((await earlyDispute.json()).result, "dispute_pending_payment");
  assert.equal(DB.terminalRecords.length, 1);

  const capture = await signedWebhook(env, "evt_capture_after_dispute", {
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_DISPUTEBEFORE", order_id: "order_TEST1", status: "captured", captured: true,
      amount: 99_900, currency: "INR",
    } } },
  });
  assert.equal(capture.status, 200);
  assert.equal((await capture.json()).result, "paid_reconciled_revoked");
  assert.equal(DB.orders[0].status, "paid");
  assert.equal(DB.orders[0].entitlement_revocation_reason, "provider_dispute_preexisting");

  const artifact = await worker.fetch(appRequest(`/api/orders/${order.id}/artifact`, { headers: authHeaders() }), env);
  assert.equal(artifact.status, 410);
});

test("unique processed partial refunds accumulate exactly once to a full refund", async () => {
  const { env, DB, decisionComparisonId } = await fixture();
  await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "cumulative-refunds-0001" }),
    body: JSON.stringify(decisionCheckoutBody(decisionComparisonId)),
  }), env);
  await signedWebhook(env, "evt_cumulative_capture", {
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_CUMULATIVE", order_id: "order_TEST1", status: "captured", captured: true,
      amount: 99_900, currency: "INR",
    } } },
  });

  const firstRefundPayload = {
    event: "refund.processed",
    payload: { refund: { entity: {
      id: "rfnd_PARTONE", payment_id: "pay_CUMULATIVE", amount: 40_000, currency: "INR", status: "processed",
    } } },
  };
  const first = await signedWebhook(env, "evt_cumulative_refund_one", firstRefundPayload);
  assert.equal((await first.json()).result, "partial_refund_recorded");
  assert.equal(DB.orders[0].status, "paid");

  const duplicateDelivery = await signedWebhook(env, "evt_cumulative_refund_one_redelivery", firstRefundPayload);
  assert.equal((await duplicateDelivery.json()).result, "partial_refund_recorded");
  assert.equal(DB.terminalRecords.length, 1);
  assert.equal(DB.orders[0].status, "paid");

  const second = await signedWebhook(env, "evt_cumulative_refund_two", {
    event: "refund.processed",
    payload: { refund: { entity: {
      id: "rfnd_PARTTWO", payment_id: "pay_CUMULATIVE", amount: 59_900, currency: "INR", status: "processed",
    } } },
  });
  assert.equal((await second.json()).result, "refunded");
  assert.equal(DB.terminalRecords.length, 2);
  assert.equal(DB.terminalRecords.reduce((sum, record) => sum + record.amount_paise, 0), 99_900);
  assert.equal(DB.orders[0].status, "refunded");
});

test("processed refunds revoke a paid Decision Compare entitlement", async () => {
  const { env, DB, decisionComparisonId } = await fixture();
  const created = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "refund-order-0001" }),
    body: JSON.stringify(decisionCheckoutBody(decisionComparisonId)),
  }), env);
  const order = (await created.json()).order;
  await signedWebhook(env, "evt_refund_setup", {
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_REFUND", order_id: "order_TEST1", status: "captured", captured: true, amount: 99_900, currency: "INR" } } },
  });

  const refund = await signedWebhook(env, "evt_refund_processed", {
    event: "refund.processed",
    payload: { refund: { entity: { id: "rfnd_TEST", payment_id: "pay_REFUND", amount: 99_900, currency: "INR", status: "processed" } } },
  });
  assert.equal(refund.status, 200);
  assert.equal((await refund.json()).result, "refunded");
  assert.equal(DB.orders[0].status, "refunded");
  assert.equal(DB.orders[0].entitlement_revocation_reason, "refund_processed");
  assert.ok(DB.orders[0].entitlement_revoked_at);

  const artifact = await worker.fetch(appRequest(`/api/orders/${order.id}/artifact`, { headers: authHeaders() }), env);
  assert.equal(artifact.status, 410);
  assert.equal((await artifact.json()).code, "entitlement_revoked");
});

test("created disputes revoke access without rewriting the paid financial state", async () => {
  const { env, DB, decisionComparisonId } = await fixture();
  const created = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "dispute-order-0001" }),
    body: JSON.stringify(decisionCheckoutBody(decisionComparisonId)),
  }), env);
  const order = (await created.json()).order;
  await signedWebhook(env, "evt_dispute_setup", {
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_DISPUTE", order_id: "order_TEST1", status: "captured", captured: true, amount: 99_900, currency: "INR" } } },
  });

  const dispute = await signedWebhook(env, "evt_dispute_created", {
    event: "payment.dispute.created",
    payload: { dispute: { entity: { id: "disp_TEST", payment_id: "pay_DISPUTE", status: "open" } } },
  });
  assert.equal(dispute.status, 200);
  assert.equal((await dispute.json()).result, "entitlement_revoked");
  assert.equal(DB.orders[0].status, "paid");
  assert.equal(DB.orders[0].entitlement_revocation_reason, "payment.dispute.created");
  assert.ok(DB.orders[0].entitlement_revoked_at);

  const artifact = await worker.fetch(appRequest(`/api/orders/${order.id}/artifact`, { headers: authHeaders() }), env);
  assert.equal(artifact.status, 410);
});

test("order reads are always scoped to the authenticated owner", async () => {
  const { env, DB } = await fixture();
  DB.orders.push(seededOrder({ id: "other-order", project_id: "project-b", user_id: "user-b", plan: "expert", product_code: "expert", amount_paise: 349_900 }));
  const response = await worker.fetch(appRequest("/api/orders/other-order", { headers: authHeaders() }), env);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "order_not_found");
});

test("project deletion preflights durable payment evidence before any file deletion", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      calls.push(sql);
      assert.match(sql, /SELECT o\.id FROM orders o/u);
      assert.match(sql, /o\.status='failed'/u);
      assert.match(sql, /o\.provider_order_id IS NULL/u);
      assert.match(sql, /o\.provider_checkout_order_id IS NULL/u);
      assert.match(sql, /o\.provider_payment_id IS NULL/u);
      assert.match(sql, /o\.checkout_url IS NULL/u);
      assert.match(sql, /payment_webhook_events/u);
      assert.match(sql, /payment_terminal_records/u);
      assert.match(sql, /payment_reconciliation_cases/u);
      assert.match(sql, /order_fulfillments/u);
      assert.match(sql, /decision_shares/u);
      assert.match(sql, /decision_progress/u);
      return {
        bind(projectId) {
          assert.equal(projectId, "project-with-order");
          return { first: async () => ({ id: "order-existing" }) };
        },
      };
    },
  };
  await assert.rejects(
    () => __test.ensureProjectDeletable(db, "project-with-order"),
    /archive it instead/u,
  );
  assert.equal(calls.length, 1);
});
