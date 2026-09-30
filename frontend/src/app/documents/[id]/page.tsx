import { DocumentViewer } from '../../../features/viewer/document-viewer';

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentViewer id={id} />;
}
