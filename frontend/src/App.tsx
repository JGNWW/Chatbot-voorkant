import { useState } from "react";
import { ask, type AskResponse } from "./api";

interface Turn {
  question: string;
  response?: AskResponse;
  error?: string;
  loading: boolean;
}

export default function App() {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question) return;
    setInput("");

    const index = turns.length;
    setTurns((t) => [...t, { question, loading: true }]);

    try {
      const response = await ask(question);
      setTurns((t) =>
        t.map((turn, i) => (i === index ? { ...turn, response, loading: false } : turn)),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Onbekende fout";
      setTurns((t) =>
        t.map((turn, i) => (i === index ? { ...turn, error: message, loading: false } : turn)),
      );
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Voorlichter-assistent</h1>
        <p>Antwoorden letterlijk overgenomen van NederlandWereldwijd.nl</p>
      </header>

      <main className="conversation">
        {turns.length === 0 && (
          <p className="empty">Stel een vraag, bijvoorbeeld: "Hoe vraag ik een paspoort aan vanuit het buitenland?"</p>
        )}
        {turns.map((turn, i) => (
          <Answer key={i} turn={turn} />
        ))}
      </main>

      <form className="composer" onSubmit={submit}>
        <input
          type="text"
          value={input}
          placeholder="Typ hier de vraag van de burger…"
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
        <button type="submit">Vraag stellen</button>
      </form>
    </div>
  );
}

function Answer({ turn }: { turn: Turn }) {
  const { question, response, error, loading } = turn;

  return (
    <article className="turn">
      <div className="user-question">
        <span className="label">Gestelde vraag</span>
        {question}
      </div>

      {loading && <div className="loading">Bezig met opzoeken op NederlandWereldwijd.nl…</div>}

      {error && <div className="error">Er ging iets mis: {error}</div>}

      {response && (
        <div className="bot-answer">
          <div className="restated">
            <span className="label">Je vraag (zoals begrepen)</span>
            {response.restated_question}
          </div>

          {response.answer ? (
            <blockquote className={response.verified ? "answer verified" : "answer unverified"}>
              {response.answer}
            </blockquote>
          ) : (
            <div className="no-answer">Geen letterlijk antwoord gevonden.</div>
          )}

          {response.note && <div className="note">{response.note}</div>}

          {response.source && (
            <div className="source">
              <span className="label">Bron</span>
              <a href={response.source.url} target="_blank" rel="noreferrer">
                {response.source.title}
              </a>
            </div>
          )}

          {response.related_sources.length > 0 && (
            <div className="related">
              <span className="label">Andere relevante bronnen</span>
              <ul>
                {response.related_sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
