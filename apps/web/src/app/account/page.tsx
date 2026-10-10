import { AccountPanel } from "@/components/account-panel";

export default function AccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
        <p className="max-w-2xl text-muted-foreground">What you have lent, what you owe, and how far you are from liquidation.</p>
      </section>
      <AccountPanel />
    </div>
  );
}
