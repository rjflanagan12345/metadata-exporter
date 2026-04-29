export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex gap-6">
        <span className="font-bold text-gray-900">APG Metadata</span>
        <a href="/admin/titles" className="text-blue-600 hover:underline">Titles</a>
        <a href="/admin/import" className="text-blue-600 hover:underline">Import</a>
      </nav>
      <main className="p-6">{children}</main>
    </div>
  )
}
