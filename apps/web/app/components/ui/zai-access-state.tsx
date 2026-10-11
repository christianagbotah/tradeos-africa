type Props = {
  kicker: string;
  title: string;
  message: string;
};

export function ZaiAccessState({ kicker, title, message }: Props) {
  return (
    <section className="zai-route-access" role="status" aria-live="polite">
      <p className="zai-route-kicker">{kicker}</p>
      <h1>{title}</h1>
      <p>{message}</p>
      <span>Read-only workspace</span>
    </section>
  );
}
