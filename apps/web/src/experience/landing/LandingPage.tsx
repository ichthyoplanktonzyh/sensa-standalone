import { ArrowDown, ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitch } from "../../i18n/LanguageSwitch";
import { SensaLogo } from "../brand/SensaLogo";
import "./landing.css";

interface LandingPageProps {
  readonly signedIn?: boolean;
  readonly onEnter: () => void;
}

export function LandingPage({ signedIn = false, onEnter }: LandingPageProps) {
  const { t, i18n } = useTranslation();
  const moments = t("landing.belief.moments", { returnObjects: true }) as Array<{ label: string; title: string; body: string }>;

  useEffect(() => {
    document.title = `${t("brand")} · ${t("landing.hero.title").replace(/\s+/g, " ")}`;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previous = description?.content;
    if (description) description.content = t("landing.meta");
    return () => {
      document.title = t("brand");
      if (description && previous) description.content = previous;
    };
  }, [i18n.resolvedLanguage, t]);

  return (
    <main className="sensa-landing" id="top">
      <a className="sensa-landing__skip" href="#landing-main">{t("landing.skip")}</a>

      <header className="sensa-landing__header">
        <a className="sensa-landing__brand" href="#top" aria-label={t("nav.homeLabel")}>
          <SensaLogo />
        </a>
        <nav className="sensa-landing__navigation" aria-label={t("landing.navigation")}>
          <a className="sensa-landing__text-link" href="/how-it-works">{t("landing.how")}</a>
          <LanguageSwitch />
          <button className="sensa-landing__header-action" type="button" onClick={onEnter}>
            {t("landing.enter")}
          </button>
        </nav>
      </header>

      <div id="landing-main">
        <section className="sensa-landing__hero" aria-labelledby="landing-title">
          <div className="sensa-landing__hero-copy">
            <span className="sensa-landing__eyebrow">{t("landing.hero.eyebrow")}</span>
            <h1 id="landing-title">{t("landing.hero.title")}</h1>
            <p>{t("landing.hero.body")}</p>
            <div className="sensa-landing__hero-actions">
              <button className="sensa-landing__primary-action" type="button" onClick={onEnter}>
                <span>{t("landing.hero.primary")}</span>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
              <a className="sensa-landing__secondary-action" href="#story">
                <span>{t("landing.hero.secondary")}</span>
                <ArrowDown size={17} aria-hidden="true" />
              </a>
            </div>
          </div>

          <figure className="sensa-landing__specimen">
            <figcaption>{t("landing.specimen.label")}</figcaption>
            <div className="sensa-landing__thread" aria-hidden="true" />
            <div className="sensa-landing__specimen-stage" data-stage="context">
              <span>{t("landing.specimen.contextTitle")}</span>
              <p>{t("landing.specimen.context")}</p>
            </div>
            <div className="sensa-landing__specimen-stage" data-stage="sense">
              <span>{t("landing.specimen.senseTitle")}</span>
              <p>{t("landing.specimen.sense")}</p>
            </div>
            <div className="sensa-landing__specimen-stage" data-stage="expression">
              <span>{t("landing.specimen.expressionTitle")}</span>
              <blockquote lang="en">{t("landing.specimen.expression")}</blockquote>
            </div>
            <p className="sensa-landing__specimen-caption">{t("landing.specimen.caption")}</p>
          </figure>
        </section>

        <section className="sensa-landing__belief" id="story" aria-labelledby="landing-belief-title">
          <div className="sensa-landing__belief-heading">
            <h2 id="landing-belief-title">{t("landing.belief.title")}</h2>
          </div>
          <div className="sensa-landing__belief-copy">
            <p>{t("landing.belief.first")}</p>
            <p>{t("landing.belief.second")}</p>
          </div>
          <div className="sensa-landing__moments">
            {moments.map((moment) => (
              <article key={moment.label}>
                <span className="sensa-landing__step-label">{moment.label}</span>
                <h3>{moment.title}</h3>
                <p>{moment.body}</p>
              </article>
            ))}
          </div>
          <blockquote>{t("landing.belief.statement")}</blockquote>
          <p className="sensa-landing__coda">{t("landing.belief.coda")}</p>
        </section>

        <section className="sensa-landing__closing" aria-labelledby="landing-closing-title">
          <div>
            <h2 id="landing-closing-title">{t("landing.close.title")}</h2>
            <p>{t("landing.close.body")}</p>
          </div>
          <button className="sensa-landing__closing-action" type="button" onClick={onEnter}>
            <span>{t("landing.close.action")}</span>
            <ArrowRight size={19} aria-hidden="true" />
          </button>
        </section>
      </div>

      <footer className="sensa-landing__footer">
        <SensaLogo />
        <p>{t("landing.footer")}</p>
      </footer>
    </main>
  );
}
