export default function SplashScreen() {
  return (
    <div className="splash" role="status" aria-label="Loading Glazion Capture">
      <img src="/mark.png" alt="" width={72} height={72} />
      <span className="spinner spinner-lg" />
    </div>
  );
}
