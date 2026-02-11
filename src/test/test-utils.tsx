import { render, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

/** Custom render that wraps with providers (MemoryRouter). */
function customRender(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { route?: string },
) {
  const { route = '/', ...renderOptions } = options ?? {};

  function Wrapper({ children }: { children: React.ReactNode }) {
    return <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>;
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

export * from '@testing-library/react';
export { customRender as render };
