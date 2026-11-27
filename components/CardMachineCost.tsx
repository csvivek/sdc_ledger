"use client";

import { useEffect, useState } from "react";
import { cardCost, cardCostShare, parseQuote } from "@/lib/analytics";
import { inr, monthLabel } from "@/lib/calc";
import { TrendChart } from "./TrendChart";

export interface CardMonth {
  month: string;
  count: number;
  amount: number;
}

const KEY = "sdc.cardQuote";

/**
 * Card money each month, and what a card machine would cost if the admin types in the bank's quote.
 * No figures are assumed: with the boxes empty, no cost is shown. The quote is remembered on this device only.
 */
export function CardMachineCost({ rows, showChart, sample }: { rows: CardMonth[]; showChart: boolean; sample: boolean }) {
  const [rate, setRate] = useState("");
  const [rent, setRent] = useState("");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (saved && typeof saved.rate === "string" && typeof saved.rent === "string") {
        setRate(saved.rate);
        setRent(saved.rent);
      }
    } catch {
      // storage blocked or bad value: start empty
    }
  }, []);

  const save = (r: string, m: string) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ rate: r, rent: m }));
    } catch {
      // ignore
    }
  };

  const quote = parseQuote(rate, rent);
  const totalCard = rows.reduce((s, r) => s + r.amount, 0);
  const avgCard = rows.length ? totalCard / rows.length : 0;
  const t = (title: string) => (sample ? `SAMPLE · ${title}` : title);

  return (
    <div className="card">
      <p className="muted" style={{ marginTop: 0 }}>
        Type in the bank&apos;s quote to see what a card machine would cost against the card money PappyJoe recorded. Leave the boxes empty
        until you have the quote. It is kept on this phone or computer only.
      </p>
      <div className="quote-inputs">
        <label>
          Bank charge per card payment (%)
          <input
            inputMode="decimal"
            placeholder="e.g. from the bank"
            value={rate}
            onChange={(e) => {
              setRate(e.target.value);
              save(e.target.value, rent);
            }}
          />
        </label>
        <label>
          Machine rent per month (₹)
          <input
            inputMode="decimal"
            placeholder="0 if none"
            value={rent}
            onChange={(e) => {
              setRent(e.target.value);
              save(rate, e.target.value);
            }}
          />
        </label>
      </div>
      {!quote && (rate.trim() !== "" || rent.trim() !== "") && (
        <p className="muted">Fill in both boxes with numbers (0 or more) to see the cost.</p>
      )}
      {quote && (
        <p>
          With this quote, an average month here ({inr(avgCard)} on card) would cost <strong>{inr(cardCost(avgCard, quote))}</strong>
          {avgCard > 0 ? `, about ${Math.round(cardCostShare(avgCard, quote) ?? 0)}% of the card money` : ""}.
        </p>
      )}

      {showChart && rows.length > 0 && (
        <TrendChart
          title={t(quote ? "Card money and machine cost" : "Card money in PappyJoe")}
          kind="bar"
          months={rows.map((r) => r.month)}
          series={[
            { name: "Card money", color: "var(--series-card)", values: rows.map((r) => r.amount) },
            ...(quote ? [{ name: "Machine cost", color: "var(--series-expenses)", values: rows.map((r) => cardCost(r.amount, quote)) }] : []),
          ]}
          notes={rows.map((r) => `${r.count} card payment${r.count === 1 ? "" : "s"}`)}
        />
      )}

      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Card payments</th>
              <th className="num">Card money</th>
              {quote && <th className="num">Machine cost</th>}
              {quote && <th className="num">Cost as % of card money</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const share = quote ? cardCostShare(r.amount, quote) : null;
              return (
                <tr key={r.month}>
                  <td className="row-title">{monthLabel(r.month)}</td>
                  <td data-label="Card payments" className="num">{r.count}</td>
                  <td data-label="Card money" className="num">{inr(r.amount)}</td>
                  {quote && <td data-label="Machine cost" className="num">{inr(cardCost(r.amount, quote))}</td>}
                  {quote && (
                    <td data-label="Cost as % of card money" className="num">
                      {share === null ? "No card money" : `${Math.round(share)}%`}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
