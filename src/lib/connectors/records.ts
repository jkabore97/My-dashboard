import { addDays, today } from "../dates";
import { latestDomainCheck, type DomainCheck } from "../server/domains";
import { listDeadlines, listInvoices, listSubscriptions, type Deadline, type Invoice, type Subscription } from "../server/store/ledger";
import { getSetting } from "../server/store/settings";
import { demoDomains } from "../demo";
import { fromSource } from "../source";

export interface Records {
  invoices: Invoice[];
  subscriptions: Subscription[];
  deadlines: Deadline[];
  /** Security checklist confirmations: item id → ISO time confirmed. */
  checklist: Record<string, string>;
}

/** Things you track by hand, from the dashboard's own database. */
export function getRecords() {
  return fromSource<Records>(
    "Records",
    true,
    async () => {
      const [invoices, subscriptions, deadlines, checklist] = await Promise.all([
        listInvoices({ paidSince: addDays(today(), -90) }),
        listSubscriptions(true),
        listDeadlines(true),
        getSetting<Record<string, string>>("security_checklist", {}),
      ]);
      return { invoices, subscriptions, deadlines, checklist };
    },
    () => ({ invoices: [], subscriptions: [], deadlines: [], checklist: {} }),
  );
}

export interface DomainsReport {
  checks: DomainCheck[];
  /** Watched but not checked yet (the next cron run or "Check now" will). */
  pending: string[];
}

/** Latest stored domain checks; the network checks themselves run in cron. */
export function getDomains(domains: string[]) {
  return fromSource<DomainsReport>(
    "Domains",
    domains.length > 0,
    async () => {
      const checks = await Promise.all(domains.map(async (d) => [d, await latestDomainCheck(d)] as const));
      return {
        checks: checks.flatMap(([, c]) => (c ? [c] : [])),
        pending: checks.filter(([, c]) => !c).map(([d]) => d),
      };
    },
    () => ({ checks: demoDomains(), pending: [] }),
  );
}
