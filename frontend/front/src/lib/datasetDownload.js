import { api } from './api'
import { downloadGeoJSON, downloadProjectsCSV, slug } from './download'

/** Every project in one dataset, as GeoJSON features (the API filters by utility; we narrow to the dataset). */
export async function datasetFeatures(ds, signal) {
  const fc = await api.projects({ utilities: ds.utility_id }, { signal })
  return fc.features.filter((f) => f.properties.dataset_id === ds.dataset_id)
}

export async function downloadDataset(ds, format) {
  const features = await datasetFeatures(ds)
  const name = `${ds.utility_id.toLowerCase()}-${slug(ds.source_name)}`
  if (format === 'csv') downloadProjectsCSV(`${name}.csv`, features)
  else downloadGeoJSON(`${name}.geojson`, features)
}
