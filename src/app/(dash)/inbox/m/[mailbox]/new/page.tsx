import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireSection } from "@/lib/server/auth";
import { errorMessage } from "@/lib/source";
import { parseAddressList, formatAddressList } from "@/lib/mail/access";
import { MailAccessError, openMailbox, publicRef } from "@/lib/server/mail";
import { Card } from "@/components/ui";
import { Composer } from "@/components/mail/Composer";
import { listQuery } from "@/components/mail/format";

type Params = Record<string, string | string[] | undefined>;

/** A new message from one mailbox (?to= prefills the recipient). */
export default async function NewMessagePage({ params, searchParams }: { params: Promise<{ mailbox: string }>; searchParams: Promise<Params> }) {
  const user = await requireSection("inbox");
  const { mailbox } = await params;
  const sp = await searchParams;
  const back = `/inbox?${listQuery({ mb: mailbox })}`;
  const backLink = <Link href={back} className="mb-3 inline-flex min-h-10 items-center gap-1 text-[13px] text-cyan hover:underline"><ChevronLeft size={15} />Back to the inbox</Link>;
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
        <Card title="New message" accent="pink"><p className="text-[13.5px] text-[#ffc2d1]">{err instanceof MailAccessError ? err.message : errorMessage(err)}</p></Card>
      </>
    );
  }
}
