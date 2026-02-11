import { Outlet, useMatch } from 'react-router-dom';

export default function SessionDetail() {
  const isChildRouteActive = useMatch('/sessions/:sessionId/signals');

  return (
    <div>
      {isChildRouteActive ? (
        <Outlet />
      ) : (
        <>
          <h1>Session Detail</h1>
          <p>Coming soon</p>
        </>
      )}
    </div>
  );
}
