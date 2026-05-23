import request, { USE_MOCK } from './request'
import { mockApi } from './mock'
import { mapDataset } from '@/utils/api-mapper'
import { DATASETS } from '@/constants/datasets'

export async function listDatasets() {
  if (USE_MOCK) {
    return DATASETS.map((d, i) => ({ ...d, id: i + 1 }))
  }
  const res = await request.get('/api/v1/datasets')
  return (res.items || []).map(mapDataset)
}
