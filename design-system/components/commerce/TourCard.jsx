import React from "react";
import { Icon } from "../icons/Icon.jsx";
import { Price } from "./Price.jsx";
import { Rating } from "../data-display/Rating.jsx";
import { AvailabilityBadge } from "../data-display/AvailabilityBadge.jsx";
import { Button } from "../actions/Button.jsx";

export function TourCard({
  title, region, duration, image, imageAlt = "", price, currency = "GHS", approxPrice,
  rating, reviewCount, spotsLeft, tag, variant = "grid", href = "#",
}) {
  return (
    <article className={["tk-card", "tk-card--interactive", "tk-tourcard", variant === "row" && "tk-tourcard--row"].filter(Boolean).join(" ")}>
      <div className="tk-media">
        {image ? <img src={image} alt={imageAlt} loading="lazy" decoding="async" />
               : <span className="tk-media__ph">Tour photo</span>}
        {tag && <span className="tk-media__tag"><span className="tk-badge tk-badge--solid">{tag}</span></span>}
      </div>
      <div className="tk-card__body">
        <div className="tk-tourcard__meta">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="map-pin" size={14} />{region}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="clock" size={14} />{duration}</span>
        </div>
        <h3 className="tk-tourcard__title">
          <a href={href} style={{ color: "inherit", textDecoration: "none" }}>{title}</a>
        </h3>
        <div className="tk-tourcard__stats">
          <span style={{ marginInlineEnd: "auto" }}>{rating != null ? <Rating value={rating} count={reviewCount} /> : null}</span>
          {spotsLeft != null ? <AvailabilityBadge spotsLeft={spotsLeft} /> : null}
        </div>
        <div className="tk-tourcard__foot">
          <Price amount={price} currency={currency} approxAmount={approxPrice} from unit="per person" />
          {variant === "grid"
            ? <Button size="sm" variant="secondary" as="a" href={href}>View</Button>
            : <Button size="sm" variant="primary" as="a" href={href}>Book</Button>}
        </div>
      </div>
    </article>
  );
}
