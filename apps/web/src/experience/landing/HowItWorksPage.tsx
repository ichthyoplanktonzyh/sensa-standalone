import { ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitch } from "../../i18n/LanguageSwitch";
import { SensaLogo } from "../brand/SensaLogo";
import "./landing.css";

export default function HowItWorksPage({ signedIn = false, onEnter }: {
  readonly signedIn?: boolean;
  readonly onEnter: () => void;
}) {
  const { t } = useTranslation();
  const steps = t("landing.use.steps", { returnObjects: true }) as Array<{ label: string; title: string; body: string }>;
  const entries = t("landing.entries.items", { returnObjects: true }) as Array<{ label: string; title: string; body: string }>;

  useEffect(() => {
    document.title = `${t("landing.how")} · ${t("brand")}`;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previous = description?.content;
    if (description) description.content = t("landing.guide.meta");
    return () => {
      document.title = t("brand");
      if (description && previous !== undefined) description.content = previous;
    };
  }, [t]);

  return (
    <main className="sensa-landing sensa-landing--guide">
      <a className="sensa-landing__skip" href="#landing-main">{t("landing.skip")}</a>
      <header className="sensa-landing__header">
        <a className="sensa-landing__brand" href="/welcome" aria-label={t("landing.back")}><SensaLogo /></a>
        <nav className="sensa-landing__navigation" aria-label={t("landing.navigation")}>
          <a className="sensa-landing__text-link" href="/welcome">{t("landing.story")}</a>
          <LanguageSwitch />
          <button className="sensa-landing__header-action" type="button" onClick={onEnter}>
            {t(signedIn ? "landing.enter" : "landing.signIn")}
          </button>
        </nav>
      </header>
      <div id="landing-main">
        <div className="sensa-landing__guide-heading">
          <span className="sensa-landing__eyebrow">{t("landing.how")}</span>
          <h1>{t("landing.guide.title")}</h1>
          <p>{t("landing.guide.body")}</p>
        </div>
        <section className="sensa-landing__use" id="how" aria-labelledby="landing-use-title">
          <div className="sensa-landing__use-intro">
            <h2 id="landing-use-title">{t("landing.use.title")}</h2>
            <p>{t("landing.use.intro")}</p>
          </div>
          <ol className="sensa-landing__steps">
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className="sensa-landing__step-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div className="sensa-landing__step-heading">
                  <span className="sensa-landing__step-label">{step.label}</span>
                  <h3>{step.title}</h3>
                </div>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
          <p className="sensa-landing__return">{t("landing.use.return")}</p>
        </section>

        <section className="sensa-landing__entries" aria-labelledby="landing-entries-title">
          <div className="sensa-landing__entries-intro">
            <h2 id="landing-entries-title">{t("landing.entries.title")}</h2>
            <p>{t("landing.entries.intro")}</p>
          </div>
          <ul className="sensa-landing__entry-list">
            {entries.map((entry) => (
              <li key={entry.label}>
                <span className="sensa-landing__step-label">{entry.label}</span>
                <h3>{entry.title}</h3>
                <p>{entry.body}</p>
              </li>
            ))}
          </ul>
          <div className="sensa-landing__book">
            <div>
              <span className="sensa-landing__step-label">{t("landing.entries.bookLabel")}</span>
              <h3>{t("landing.entries.bookTitle")}</h3>
            </div>
            <p>{t("landing.entries.bookBody")}</p>
          </div>
        </section>


        <div className="sensa-landing__guide-action">
          <button className="sensa-landing__primary-action" type="button" onClick={onEnter}>
            <span>{t("landing.enter")}</span><ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <footer className="sensa-landing__footer"><SensaLogo /><p>{t("landing.footer")}</p></footer>
    </main>
  );
}
