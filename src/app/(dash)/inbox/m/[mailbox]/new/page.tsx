import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireSection } from "@/lib/server/auth";
import { errorMessage } from "@/lib/source";
import { parseAddressList, formatAddressList } from "@/lib/mail/access";
import { MailAccessError, openMailbox, publicRef } from "@/lib/server/mail";
import { Composer } from "@/components/mail/Composer";
import { listQuery } from "@/components/mail/format";

type Params = Record<string, string | string[] | undefined>;

/** A new message from one mailbox (?to= prefills the recipient). */
export default async function NewMessagePage({ params, searchParams }: { params: Promise<{ mailbox: string }>; searchParams: Promise<Params> }) {
  const user = await requireSection("inbox");
  const { mailbox } = await params;
  const sp = await searchParams;
  const back = `/inbox?${listQuery({ mb: mailbox })}`;
  const backLink = <Link href={back} className="-ml-1.5 mb-2 inline-flex min-h-10 items-center gap-0.5 text-[17px] text-cyan hover:opacity-70"><ChevronLeft size={22} />Inbox</Link>;
  try {
    const o = await openMailbox(user, mailbox, "send");
    const ref = publicRef(o.h);
    const toParam = typeof sp.to === "string" ? parseAddressList(sp.to) : { list: [] };
    const to = "list" in toParam ? formatAddressList(toParam.list) : "";
    return (
      <>
        {backLink}
        <Composer mailbox={{ key: ref.key, label: ref.label, address: ref.address }} mode="new" defaults={{ to, cc: "", subject: "" }} ai={false} backHref={back} />
      </>
    );
  } catch (err) {
    return (
      <>
        {backLink}
        <div className="rounded-[14px] bg-critical/10 px-4 py-3 text-[15px] text-ink"><b className="font-semibold text-critical">Can&apos;t write from this mailbox.</b> {err instanceof MailAccessError ? err.message : errorMessage(err)}</div>
      </>
    );
  }
}
