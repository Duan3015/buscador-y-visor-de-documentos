import { UploadPanel } from '../../features/upload/upload-panel';

export default function UploadPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">Cargar documentos</h1>
      <UploadPanel />
    </div>
  );
}
