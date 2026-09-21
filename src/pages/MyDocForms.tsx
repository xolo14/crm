import AssignedDocFormLinksCard from "@/components/forms/AssignedDocFormLinksCard";

export default function MyDocForms() {
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-5xl">
      <h1 className="text-lg font-semibold mb-1">Certificate & offer-letter forms</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Forms assigned to you. Each public link includes only your staff ID so submissions are attributed to you.
      </p>
      <AssignedDocFormLinksCard showEmpty />
    </div>
  );
}
