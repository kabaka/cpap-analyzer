import { Dialog, Button } from 'cpap-analyzer';

export const Confirmation = () => (
  <Dialog
    open
    title="Delete imported session?"
    description="This removes the night of Jul 2 and its 8.1 hours of flow-rate data. This action cannot be undone."
  >
    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
      <Button variant="secondary">Cancel</Button>
      <Button variant="danger">Delete session</Button>
    </div>
  </Dialog>
);
