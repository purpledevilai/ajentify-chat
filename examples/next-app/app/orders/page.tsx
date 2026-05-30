'use client';

import { useMemo, useState } from 'react';
import { useDoPageAction, useGetPageData } from '@ajentify/chat';

interface Order {
  id: string;
  customer: string;
  total: number;
  refunded: boolean;
  status: 'paid' | 'shipped' | 'delivered';
}

const initialOrders: Order[] = [
  { id: 'ord_2001', customer: 'Avery Wong', total: 320.0, refunded: false, status: 'paid' },
  { id: 'ord_2002', customer: 'Sam Patel', total: 78.45, refunded: false, status: 'delivered' },
  { id: 'ord_2003', customer: 'Lina Becker', total: 18.0, refunded: false, status: 'shipped' },
];

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [selectedId, setSelectedId] = useState<string>(initialOrders[0]!.id);
  const selected = orders.find((o) => o.id === selectedId);

  useGetPageData(
    () => ({
      data: {
        page: 'orders',
        orders,
        selected_order_id: selectedId,
      },
      actions: {
        select_order: {
          description: 'Select an order by id.',
          argsSchema: {
            type: 'object',
            properties: { order_id: { type: 'string' } },
            required: ['order_id'],
          },
        },
        refund_selected_order: {
          description: 'Refund the currently selected order.',
          argsSchema: { type: 'object', properties: {} },
        },
      },
    }),
    [orders, selectedId]
  );

  useDoPageAction(
    async (key, args) => {
      if (key === 'select_order') {
        const id = String(args.order_id ?? '');
        if (!orders.find((o) => o.id === id)) {
          return { ok: false, error: `unknown order_id: ${id}` };
        }
        setSelectedId(id);
        return { ok: true, selected_order_id: id };
      }
      if (key === 'refund_selected_order') {
        const id = selectedId;
        setOrders((prev) =>
          prev.map((o) => (o.id === id ? { ...o, refunded: true } : o))
        );
        return { ok: true, refunded_order_id: id };
      }
      return { ok: false, error: `unknown action: ${key}` };
    },
    [orders, selectedId]
  );

  const totalsByStatus = useMemo(() => {
    const out: Record<string, number> = {};
    for (const o of orders) {
      out[o.status] = (out[o.status] ?? 0) + 1;
    }
    return out;
  }, [orders]);

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Orders</h1>
      <Card>
        <CardTitle>Status</CardTitle>
        <p className="text-muted-foreground">
          {Object.entries(totalsByStatus)
            .map(([s, n]) => `${n} ${s}`)
            .join(' · ')}
        </p>
      </Card>
      <Card>
        <CardTitle>All orders</CardTitle>
        <div className="flex flex-col gap-2">
          {orders.map((o) => {
            const isSelected = o.id === selectedId;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setSelectedId(o.id)}
                className={
                  'flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ' +
                  (isSelected
                    ? 'border-primary ring-1 ring-primary'
                    : 'border-border hover:bg-accent/50')
                }
              >
                <div>
                  <div className="font-semibold">{o.id}</div>
                  <div className="text-xs text-muted-foreground">
                    {o.customer} · {o.status}
                    {o.refunded ? ' · refunded' : ''}
                  </div>
                </div>
                <div className="font-semibold">${o.total.toFixed(2)}</div>
              </button>
            );
          })}
        </div>
      </Card>
      {selected ? (
        <Card>
          <CardTitle>Selected: {selected.id}</CardTitle>
          <p>Customer: {selected.customer}</p>
          <p>Total: ${selected.total.toFixed(2)}</p>
          <p>Status: {selected.status}</p>
          <p>Refunded: {selected.refunded ? 'yes' : 'no'}</p>
          <p className="mt-4 text-sm text-muted-foreground">
            Tip: open the chat and ask <em>&ldquo;refund the selected order&rdquo;</em>.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-lg font-semibold">{children}</h2>;
}
