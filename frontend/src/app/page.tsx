import { Suspense } from 'react';
import { SearchPage } from '../features/search/search-page';

export default function HomePage() {
  // useSearchParams exige un limite de Suspense para poder generar la pagina de forma estatica.
  return (
    <Suspense fallback={null}>
      <SearchPage />
    </Suspense>
  );
}
