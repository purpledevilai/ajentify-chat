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
    <div className="page">
      <h1>Orders</h1>
      <div className="card">
        <h2>Status</h2>
        <p>
          {Object.entries(totalsByStatus)
            .map(([s, n]) => `${n} ${s}`)
            .join(' · ')}
        </p>
      </div>
      <div className="card">
        <h2>All orders</h2>
        <div className="order-list">
          {orders.map((o) => (
            <div
              key={o.id}
              className={`order-row${o.id === selectedId ? ' selected' : ''}`}
              onClick={() => setSelectedId(o.id)}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{o.id}</div>
                <div style={{ fontSize: 13, opacity: 0.6 }}>
                  {o.customer} · {o.status}
                  {o.refunded ? ' · refunded' : ''}
                </div>
              </div>
              <div style={{ fontWeight: 600 }}>${o.total.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>
      {selected ? (
        <div className="card">
          <h2>Selected: {selected.id}</h2>
          <p>Customer: {selected.customer}</p>
          <p>Total: ${selected.total.toFixed(2)}</p>
          <p>Status: {selected.status}</p>
          <p>Refunded: {selected.refunded ? 'yes' : 'no'}</p>
          <p style={{ fontSize: 13, opacity: 0.6, marginTop: 16 }}>
            Tip: open the chat and ask <em>"refund the selected order"</em>.
          </p>
        </div>
      ) : null}
    </div>
  );
}
