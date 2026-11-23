export default function handler(_req: unknown, res: {status: (code: number) => {json: (data: unknown) => void}; json: (data: unknown) => void}) {
  const apiKey =
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';
  res.status(200).json({apiKey});
}
