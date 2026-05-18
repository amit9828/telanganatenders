export default function Legal() {
  return (
    <div className="min-h-screen bg-slate-50 py-12">
      <div className="container mx-auto px-4 max-w-4xl bg-white p-8 sm:p-12 rounded-2xl shadow-sm border border-slate-200">
        <h1 className="text-3xl sm:text-4xl font-extrabold mb-10 text-[#0A2647] text-center border-b pb-6">
          Legal Agreements & Policies
        </h1>

        <section id="terms" className="mb-12">
          <h2 className="text-2xl font-bold mb-4 text-[#16a34a] flex items-center gap-2">
            📄 Terms & Conditions
          </h2>
          <p className="mb-4 text-slate-600 leading-relaxed">Welcome to Telangana Tenders. By accessing our website, you agree to these terms:</p>
          <ul className="list-disc ml-6 space-y-2 text-slate-700">
            <li>This is a private service portal, not an official government website.</li>
            <li>The tender information provided is for reference and convenience purposes.</li>
            <li>We are not responsible for any modifications, delays, or cancellations of tenders by the respective government departments.</li>
            <li>Users must verify the original documents before applying for any tender.</li>
          </ul>
        </section>

        <section id="privacy" className="mb-12">
          <h2 className="text-2xl font-bold mb-4 text-[#16a34a] flex items-center gap-2">
            🔒 Privacy Policy
          </h2>
          <p className="mb-4 text-slate-600 leading-relaxed">Your privacy is important to us.</p>
          <ul className="list-disc ml-6 space-y-2 text-slate-700">
            <li>We collect your email ID solely for the purpose of account creation, sending alerts, and delivering PDF documents.</li>
            <li>We do not sell, rent, or share your personal data with third parties.</li>
            <li>All payments are securely processed via Razorpay. We do not store your credit/debit card or bank details on our servers.</li>
          </ul>
        </section>

        <section id="refund" className="mb-12">
          <h2 className="text-2xl font-bold mb-4 text-[#16a34a] flex items-center gap-2">
            💸 Refund & Cancellation Policy
          </h2>
          <p className="mb-4 text-slate-600 leading-relaxed">Please read our refund policy carefully before making a payment:</p>
          <ul className="list-disc ml-6 space-y-2 text-slate-700">
            <li>Since the digital PDF is instantly delivered and unlocked upon payment, <strong>all sales are final.</strong></li>
            <li>No refunds will be issued once the payment is successful and the document access is granted.</li>
            <li>In case of a technical error where payment is deducted but access is not granted, please contact us within 24 hours at <strong>support@tgtenders.co.in</strong> for a resolution or refund.</li>
            <li>Subscriptions auto-renew based on your plan but can be cancelled at any time from your account settings to prevent future billing.</li>
          </ul>
        </section>

        <div className="mt-12 text-center pt-6 border-t">
          <a href="/" className="text-[#0A2647] font-bold hover:text-[#16a34a] transition">
            &larr; Back to Home
          </a>
        </div>
      </div>
    </div>
  );
}
