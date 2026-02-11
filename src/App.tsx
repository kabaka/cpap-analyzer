import { RouterProvider } from 'react-router-dom';
import { router } from '@/router';
import { RootErrorBoundary } from '@/components/errors';

function App() {
  return (
    <RootErrorBoundary>
      <RouterProvider router={router} />
    </RootErrorBoundary>
  );
}

export default App;
