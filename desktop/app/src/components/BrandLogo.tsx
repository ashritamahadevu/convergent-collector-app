export default function BrandLogo({ className }: { className?: string }) {
  return (
    <img
      alt="DrawBridge"
      className={className}
      src="./assets/drawbridge-logo.png"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
